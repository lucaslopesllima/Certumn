// Configurações: navegação entre seções e todos os editores (empresas, contatos,
// cenários/ações, funil, alertas, SMTP). Cobre CRUD, gating por permissão e erros.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Settings } from '../src/pages/Settings.tsx';
import { api } from '../src/lib/api.ts';
import { useAuth, type User } from '../src/lib/auth.tsx';
import { toast } from '../src/lib/toast.tsx';
import { confirmDialog } from '../src/lib/confirm.ts';

// Empresa devolvida pelo CompanySearch (controlável por teste).
const hoisted = vi.hoisted(() => ({
  companyHit: {
    id: 99, cnpj: '12345678000199', razao_social: 'Fornecedor RS',
    nome_fantasia: 'RS Marca', telefone1: '4830001111', email: 'contato@rs.com',
  } as Record<string, unknown>,
}));

vi.mock('../src/lib/api.ts', async (orig) => {
  const real = await orig() as Record<string, unknown>;
  return { ...real, api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn(), invalidate: vi.fn() } };
});
vi.mock('../src/lib/auth.tsx', () => {
  const useAuth = vi.fn();
  return { useAuth, useOptionalUser: () => useAuth().user ?? null };
});
vi.mock('../src/lib/toast.tsx', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock('../src/lib/confirm.ts', () => ({ confirmDialog: vi.fn() }));
vi.mock('../src/lib/companySearch.tsx', () => ({
  CompanySearch: ({ onPick }: { onPick: (c: unknown) => void }) => (
    <button type="button" onClick={() => onPick(hoisted.companyHit)}>mock-pick</button>
  ),
}));

const m = vi.mocked(api);
const useAuthMock = vi.mocked(useAuth);
const toastMock = vi.mocked(toast);
const confirmMock = vi.mocked(confirmDialog);

const admin: User = { id: 1, email: 'a@b.c', role: 'admin', org_id: 1, org_nome: 'Org' };

// Fixtures reatribuíveis por teste antes do render.
let reps: Record<string, unknown>[];
let contacts: Record<string, unknown>[];
let scenarios: Record<string, unknown>[];
let stages: Record<string, unknown>[];
let brands: Record<string, unknown>[];
let smtp: Record<string, unknown> | null;

function setAuth(over: { user?: Partial<User>; can?: (c: string) => boolean } = {}): void {
  useAuthMock.mockReturnValue({
    user: { ...admin, ...(over.user ?? {}) }, loading: false,
    login: vi.fn(), register: vi.fn(), refresh: vi.fn(), logout: vi.fn(),
    can: over.can ?? (() => true), isOffice: true,
  });
}

beforeEach(() => {
  m.get.mockReset(); m.post.mockReset(); m.put.mockReset(); m.patch.mockReset(); m.del.mockReset();
  toastMock.success.mockReset(); toastMock.error.mockReset();
  confirmMock.mockReset(); confirmMock.mockResolvedValue(true);
  reps = []; contacts = []; scenarios = [{ id: 7, nome: 'Compra do concorrente' }];
  stages = [{ id: 1, nome: 'Prospecção', ordem: 1 }, { id: 2, nome: 'Fechamento', ordem: 2 }];
  brands = []; smtp = null;
  setAuth();
  m.get.mockImplementation(async (p: string) => {
    if (p === '/api/account') return { org: { inatividade_dias: 15 } };
    if (p === '/api/settings/smtp') return { smtp };
    if (p === '/api/stages') return { stages };
    if (p === '/api/represented') return { empresas: reps };
    if (p === '/api/contacts') return { contacts };
    if (p === '/api/scenarios') return { items: scenarios };
    if (p === '/api/actions') return { items: [] };
    if (p.startsWith('/api/brands')) return { brands };
    return {};
  });
});

const go = (name: RegExp): Promise<void> => userEvent.click(screen.getByRole('button', { name }));

describe('Settings — navegação e gating', () => {
  it('abre nas empresas e navega entre seções', async () => {
    render(<Settings />);
    expect(await screen.findByText('Nenhuma empresa cadastrada')).toBeInTheDocument();
    await go(/Cenários/);
    expect(await screen.findByDisplayValue('Compra do concorrente')).toBeInTheDocument();
    await go(/Ações próximo nível/);
    expect(await screen.findByText('Nada cadastrado. Adicione abaixo.')).toBeInTheDocument();
    await go(/Funil/);
    expect(await screen.findByDisplayValue('Prospecção')).toBeInTheDocument();
    await go(/Contatos/);
    expect(await screen.findByText('Nenhum contato')).toBeInTheDocument();
    await go(/Empresas representadas/);
    expect(await screen.findByText('Nenhuma empresa cadastrada')).toBeInTheDocument();
  });

  it('seções admin escondidas para não-admin', () => {
    setAuth({ user: { role: 'vendedor' } });
    render(<Settings />);
    expect(screen.queryByRole('button', { name: /Alertas/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /E-mail \(SMTP\)/ })).not.toBeInTheDocument();
  });
});

describe('Settings — AlertasEditor', () => {
  it('carrega, valida e salva os dias de inatividade', async () => {
    m.patch.mockResolvedValueOnce({});
    render(<Settings />);
    await go(/Alertas/);
    const input = await screen.findByDisplayValue('15');

    // validação: vazio
    await userEvent.clear(input);
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(toastMock.error).toHaveBeenCalledWith('Informe um número de dias válido.');
    expect(m.patch).not.toHaveBeenCalled();

    // salva ok
    await userEvent.type(input, '20');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(m.patch).toHaveBeenCalledWith('/api/account', { inatividade_dias: 20 }));
    expect(await screen.findByText('Salvo')).toBeInTheDocument();
    expect(toastMock.success).toHaveBeenCalledWith('Alerta de inatividade salvo.');
  });

  it('mostra erro quando o PATCH falha', async () => {
    m.patch.mockRejectedValueOnce(new Error('boom'));
    render(<Settings />);
    await go(/Alertas/);
    await screen.findByDisplayValue('15');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith('boom'));
  });
});

describe('Settings — SmtpEditor', () => {
  it('sem config: valida host/e-mail obrigatórios', async () => {
    render(<Settings />);
    await go(/E-mail \(SMTP\)/);
    await screen.findByText('Servidor de e-mail (SMTP)');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(toastMock.error).toHaveBeenCalledWith('Informe o host e o e-mail de origem.');
    expect(m.put).not.toHaveBeenCalled();
  });

  it('carrega config existente e salva mantendo a senha', async () => {
    smtp = { host: 'smtp.rs.com', port: 465, secure: true, username: 'u', from_email: 'no@rs.com', from_name: 'RS', enabled: true, has_password: true };
    m.put.mockResolvedValueOnce({});
    render(<Settings />);
    await go(/E-mail \(SMTP\)/);
    expect(await screen.findByDisplayValue('smtp.rs.com')).toBeInTheDocument();
    expect(screen.getByText('(definida)')).toBeInTheDocument();
    // toca alguns campos (checkboxes, porta) sem preencher senha
    await userEvent.click(screen.getByRole('checkbox', { name: /Conexão segura/ }));
    await userEvent.click(screen.getByRole('checkbox', { name: /Disparo ativo/ }));
    const port = screen.getByDisplayValue('465');
    await userEvent.clear(port); // Number('')||587
    await userEvent.type(port, '25');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(m.put).toHaveBeenCalled());
    const body = m.put.mock.calls[0]![1] as Record<string, unknown>;
    expect(body.password).toBeNull();
    expect(toastMock.success).toHaveBeenCalledWith('SMTP salvo.');
  });

  it('config nula: salva com senha nova e trata erro', async () => {
    smtp = null;
    m.put.mockRejectedValueOnce(new Error('smtp-fail'));
    render(<Settings />);
    await go(/E-mail \(SMTP\)/);
    await screen.findByText('Servidor de e-mail (SMTP)');
    await userEvent.type(screen.getByPlaceholderText('smtp.seudominio.com'), 'smtp.x.com');
    await userEvent.type(screen.getByPlaceholderText('naoresponda@seudominio.com'), 'a@x.com');
    await userEvent.type(screen.getByPlaceholderText('login do SMTP'), 'user');
    await userEvent.type(screen.getByPlaceholderText('senha do SMTP'), 'segredo');
    await userEvent.type(screen.getByPlaceholderText('Sua Empresa'), 'X');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith('smtp-fail'));

    // agora sucesso: setHasPassword(true) e limpa a senha
    m.put.mockResolvedValueOnce({});
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith('SMTP salvo.'));
    const body = m.put.mock.calls.at(-1)![1] as Record<string, unknown>;
    expect(body.password).toBe('segredo');
    expect(await screen.findByText('(definida)')).toBeInTheDocument();
  });

  it('envia e-mail de teste (ok e erro)', async () => {
    smtp = { host: 'h', port: 587, secure: false, username: null, from_email: 'f@x.com', from_name: null, enabled: false, has_password: false };
    m.post.mockResolvedValueOnce({ ok: true, to: 'dest@x.com' });
    render(<Settings />);
    await go(/E-mail \(SMTP\)/);
    await screen.findByDisplayValue('h');
    await userEvent.click(screen.getByRole('button', { name: 'Enviar teste' }));
    await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith('E-mail de teste enviado para dest@x.com.'));

    m.post.mockRejectedValueOnce(new Error('test-fail'));
    await userEvent.click(screen.getByRole('button', { name: 'Enviar teste' }));
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith('test-fail'));
  });

  it('esconde ações sem permissão', async () => {
    setAuth({ can: () => false });
    smtp = { host: 'h', port: 587, secure: false, username: null, from_email: 'f@x.com', from_name: null, enabled: false, has_password: false };
    render(<Settings />);
    await go(/E-mail \(SMTP\)/);
    await screen.findByDisplayValue('h');
    expect(screen.queryByRole('button', { name: 'Salvar' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Enviar teste' })).not.toBeInTheDocument();
  });
});

describe('Settings — FunilEditor', () => {
  it('adiciona, renomeia, move e exclui fases', async () => {
    m.post.mockResolvedValueOnce({ stage: { id: 3, nome: 'Pós-venda', ordem: 3 } });
    m.patch.mockResolvedValue({});
    m.del.mockResolvedValueOnce({});
    render(<Settings />);
    await go(/Funil/);
    await screen.findByDisplayValue('Prospecção');

    // adicionar vazio: não chama post
    await userEvent.click(screen.getByRole('button', { name: 'Adicionar' }));
    expect(m.post).not.toHaveBeenCalled();

    // adicionar ok
    await userEvent.type(screen.getByPlaceholderText(/Nova fase/), 'Pós-venda');
    await userEvent.click(screen.getByRole('button', { name: 'Adicionar' }));
    await waitFor(() => expect(m.post).toHaveBeenCalledWith('/api/stages', { nome: 'Pós-venda' }));
    expect(await screen.findByDisplayValue('Pós-venda')).toBeInTheDocument();

    // renomear via Enter (foca antes p/ o blur disparar o evento)
    const first = screen.getByDisplayValue('Prospecção');
    first.focus();
    fireEvent.change(first, { target: { value: 'Prospect 2' } });
    fireEvent.keyDown(first, { key: 'Enter' });
    await waitFor(() => expect(m.patch).toHaveBeenCalledWith('/api/stages/1', { nome: 'Prospect 2' }));

    // renomear sem mudança: nenhum patch novo
    const calls = m.patch.mock.calls.length;
    fireEvent.blur(screen.getByDisplayValue('Fechamento'));
    expect(m.patch.mock.calls.length).toBe(calls);

    // renomear vazio: retorna cedo
    const second = screen.getByDisplayValue('Fechamento');
    fireEvent.change(second, { target: { value: '   ' } });
    fireEvent.blur(second);
    expect(m.patch.mock.calls.length).toBe(calls);

    // mover: descer a primeira fase e subir a segunda (cobre ambas direções)
    await userEvent.click(screen.getAllByLabelText('Descer')[0]!);
    await waitFor(() => expect(m.patch).toHaveBeenCalledWith('/api/stages/1', { ordem: expect.any(Number) }));
    await userEvent.click(screen.getAllByLabelText('Subir')[1]!);

    // excluir a primeira
    await userEvent.click(screen.getAllByLabelText('Excluir')[0]!);
    await waitFor(() => expect(m.del).toHaveBeenCalled());
    expect(toastMock.success).toHaveBeenCalledWith('Fase excluída.');
  });

  it('erros: add falha, rename falha, delete cancelado, delete falha, lista vazia', async () => {
    m.post.mockRejectedValueOnce(new Error('add-fail'));
    render(<Settings />);
    await go(/Funil/);
    await screen.findByDisplayValue('Prospecção');

    await userEvent.type(screen.getByPlaceholderText(/Nova fase/), 'X');
    await userEvent.click(screen.getByRole('button', { name: 'Adicionar' }));
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith('add-fail'));

    // rename falha
    m.patch.mockRejectedValueOnce(new Error('ren-fail'));
    const first = screen.getByDisplayValue('Prospecção');
    fireEvent.change(first, { target: { value: 'Nova' } });
    fireEvent.blur(first);
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith('ren-fail'));

    // delete cancelado
    confirmMock.mockResolvedValueOnce(false);
    await userEvent.click(screen.getAllByLabelText('Excluir')[0]!);
    expect(m.del).not.toHaveBeenCalled();

    // delete falha
    m.del.mockRejectedValueOnce(new Error('del-fail'));
    await userEvent.click(screen.getAllByLabelText('Excluir')[0]!);
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith('del-fail'));
  });

  it('lista vazia e gating de permissões', async () => {
    stages = [];
    setAuth({ can: () => false });
    render(<Settings />);
    await go(/Funil/);
    expect(await screen.findByText('Nenhuma fase. Adicione abaixo.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Adicionar' })).not.toBeInTheDocument();
  });
});

describe('Settings — NamedListEditor (cenários)', () => {
  it('adiciona, renomeia e exclui', async () => {
    m.post.mockResolvedValueOnce({ item: { id: 8, nome: 'Novo cenário X' } });
    m.patch.mockResolvedValueOnce({});
    m.del.mockResolvedValueOnce({});
    render(<Settings />);
    await go(/Cenários/);
    await screen.findByDisplayValue('Compra do concorrente');

    const input = screen.getByPlaceholderText(/Novo cenário/);
    await userEvent.type(input, 'Novo cenário X');
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(m.post).toHaveBeenCalledWith('/api/scenarios', { nome: 'Novo cenário X' }));
    expect(toastMock.success).toHaveBeenCalledWith('Item adicionado.');

    // renomear (Enter dispara o blur -> foca antes)
    const item = screen.getByDisplayValue('Compra do concorrente');
    item.focus();
    fireEvent.change(item, { target: { value: 'Editado' } });
    fireEvent.keyDown(item, { key: 'Enter' });
    await waitFor(() => expect(m.patch).toHaveBeenCalledWith('/api/scenarios/7', { nome: 'Editado' }));

    // excluir
    await userEvent.click(screen.getAllByLabelText('Excluir')[0]!);
    await waitFor(() => expect(m.del).toHaveBeenCalledWith('/api/scenarios/7'));
    expect(toastMock.success).toHaveBeenCalledWith('Item excluído.');
  });

  it('erros: add vazio/falha, rename vazio/falha, delete cancelado/falha', async () => {
    render(<Settings />);
    await go(/Cenários/);
    await screen.findByDisplayValue('Compra do concorrente');

    // add vazio
    await userEvent.click(screen.getByRole('button', { name: 'Adicionar' }));
    expect(m.post).not.toHaveBeenCalled();

    // add falha
    m.post.mockRejectedValueOnce(new Error('nl-add'));
    await userEvent.type(screen.getByPlaceholderText(/Novo cenário/), 'Y');
    await userEvent.click(screen.getByRole('button', { name: 'Adicionar' }));
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith('nl-add'));

    // rename vazio: retorna cedo
    const item = screen.getByDisplayValue('Compra do concorrente');
    fireEvent.change(item, { target: { value: '  ' } });
    fireEvent.blur(item);
    expect(m.patch).not.toHaveBeenCalled();

    // rename falha
    m.patch.mockRejectedValueOnce(new Error('nl-ren'));
    fireEvent.change(item, { target: { value: 'Z' } });
    fireEvent.blur(item);
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith('nl-ren'));

    // delete cancelado
    confirmMock.mockResolvedValueOnce(false);
    await userEvent.click(screen.getAllByLabelText('Excluir')[0]!);
    expect(m.del).not.toHaveBeenCalled();

    // delete falha
    m.del.mockRejectedValueOnce(new Error('nl-del'));
    await userEvent.click(screen.getAllByLabelText('Excluir')[0]!);
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith('Não foi possível excluir.'));
  });

  it('gating: input desabilitado e sem botões sem permissão', async () => {
    setAuth({ can: () => false });
    render(<Settings />);
    await go(/Cenários/);
    const item = await screen.findByDisplayValue('Compra do concorrente');
    expect(item).toBeDisabled();
    expect(screen.queryByPlaceholderText(/Novo cenário/)).not.toBeInTheDocument();
  });
});

describe('Settings — RepresentadasEditor', () => {
  const rep = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    id: 5, nome: 'ACME', cnpj: '123', segmento: 'Calçados', site: 'x.com',
    contato: 'joao', notas: 'nota importante', ativo: true, ...over,
  });

  it('cria uma representada puxando dados da base', async () => {
    m.post.mockResolvedValueOnce({ empresa: rep({ id: 6, nome: 'RS Marca' }) });
    render(<Settings />);
    await screen.findByText('Nenhuma empresa cadastrada');
    await userEvent.click(screen.getByRole('button', { name: 'Nova' }));

    // preenche via CompanySearch
    await userEvent.click(screen.getByText('mock-pick'));
    const nome = await screen.findByDisplayValue('RS Marca');
    expect(nome).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(m.post).toHaveBeenCalledWith('/api/represented', expect.objectContaining({ nome: 'RS Marca' })));
    expect(toastMock.success).toHaveBeenCalledWith('Representada criada.');
  });

  it('form não envia sem nome e cria com erro', async () => {
    m.post.mockRejectedValueOnce(new Error('rep-fail'));
    render(<Settings />);
    await screen.findByText('Nenhuma empresa cadastrada');
    await userEvent.click(screen.getByRole('button', { name: 'Nova' }));

    // submit sem nome: nada
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(m.post).not.toHaveBeenCalled();

    await userEvent.type(screen.getByPlaceholderText(/Nome da empresa/), 'Teste');
    // mexe no CNPJ (máscara) e nas notas
    await userEvent.type(screen.getByPlaceholderText('CNPJ'), '11222333000181');
    await userEvent.type(screen.getByPlaceholderText(/Notas/), 'obs');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith('rep-fail'));

    // cancela o formulário novo (onCancel)
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByPlaceholderText(/Nome da empresa/)).not.toBeInTheDocument();
  });

  it('lista, edita, alterna ativo e exclui', async () => {
    reps = [rep(), rep({ id: 8, nome: 'Sem detalhes', cnpj: null, contato: null, site: null, notas: null, segmento: null, ativo: false })];
    m.patch.mockResolvedValue({ empresa: rep({ nome: 'ACME editado' }) });
    m.del.mockResolvedValueOnce({});
    render(<Settings />);
    expect(await screen.findByText('ACME')).toBeInTheDocument();
    expect(screen.getByText('ativa')).toBeInTheDocument();
    expect(screen.getByText('inativa')).toBeInTheDocument();
    expect(screen.getByText('sem detalhes')).toBeInTheDocument();
    expect(screen.getByText('Calçados')).toBeInTheDocument();

    // editar -> salva update (patch)
    await userEvent.click(screen.getAllByLabelText('Editar')[0]!);
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(m.patch).toHaveBeenCalledWith('/api/represented/5', expect.objectContaining({ nome: 'ACME' })));
    expect(toastMock.success).toHaveBeenCalledWith('Representada salva.');

    // alternar ativo (sucesso)
    await userEvent.click(screen.getByTitle('Desativar'));
    await waitFor(() => expect(m.patch).toHaveBeenCalledWith('/api/represented/5', { ativo: false }));

    // excluir (confirm true)
    await userEvent.click(screen.getAllByLabelText('Excluir')[0]!);
    await waitFor(() => expect(m.del).toHaveBeenCalledWith('/api/represented/5'));
    expect(toastMock.success).toHaveBeenCalledWith('Representada excluída.');
  });

  it('reverte quando toggle/exclusão/edição falham', async () => {
    reps = [rep()];
    render(<Settings />);
    await screen.findByText('ACME');

    // toggle falha -> reverte + toast
    m.patch.mockRejectedValueOnce(new Error('x'));
    await userEvent.click(screen.getByTitle('Desativar'));
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith('Não foi possível atualizar.'));

    // update falha
    m.patch.mockRejectedValueOnce(new Error('upd-fail'));
    await userEvent.click(screen.getAllByLabelText('Editar')[0]!);
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith('upd-fail'));
    // cancelar o form de edição
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));

    // delete cancelado
    confirmMock.mockResolvedValueOnce(false);
    await userEvent.click(screen.getAllByLabelText('Excluir')[0]!);
    expect(m.del).not.toHaveBeenCalled();

    // delete falha -> reverte
    m.del.mockRejectedValueOnce(new Error('d'));
    await userEvent.click(screen.getAllByLabelText('Excluir')[0]!);
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith('Não foi possível excluir.'));
  });

  it('BrandsEditor: lista, adiciona e remove marcas', async () => {
    reps = [rep()];
    brands = [{ id: 1, represented_id: 5, nome: 'Marca A' }];
    m.post.mockResolvedValueOnce({ brand: { id: 2, represented_id: 5, nome: 'Marca B' } });
    m.del.mockResolvedValueOnce({});
    render(<Settings />);
    await screen.findByText('ACME');
    await userEvent.click(screen.getAllByLabelText('Editar')[0]!);
    expect(await screen.findByText('Marca A')).toBeInTheDocument();

    // adicionar vazio: nada
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(m.post).not.toHaveBeenCalled();

    await userEvent.type(screen.getByPlaceholderText('Nova marca'), 'Marca B');
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(m.post).toHaveBeenCalledWith('/api/brands', { represented_id: 5, nome: 'Marca B' }));
    expect(await screen.findByText('Marca B')).toBeInTheDocument();

    // remover marca (a primeira, Marca A)
    await userEvent.click(screen.getAllByLabelText('Remover')[0]!);
    await waitFor(() => expect(m.del).toHaveBeenCalledWith('/api/brands/1'));
  });

  it('BrandsEditor vazio e gating de permissões', async () => {
    reps = [rep()];
    brands = [];
    setAuth({ can: () => false });
    render(<Settings />);
    await screen.findByText('ACME');
    // sem represented.update não há botão Editar → não abre BrandsEditor; valida gating no topo
    expect(screen.queryByRole('button', { name: 'Nova' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Editar')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Excluir')).not.toBeInTheDocument();
  });
});

describe('Settings — ContatosEditor', () => {
  const rep = { id: 5, nome: 'ACME', cnpj: null, segmento: null, site: null, contato: null, notas: null, ativo: true };
  const contact = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    id: 10, nome: 'Maria', cargo: 'Compradora', email: 'maria@x.com', telefone: '4899', represented_id: 5, ...over,
  });

  it('cria contato com validação de e-mail', async () => {
    reps = [rep];
    m.post.mockResolvedValueOnce({ contact: contact({ id: 11, nome: 'Novo' }) });
    render(<Settings />);
    await go(/Contatos/);
    await screen.findByText('Nenhum contato');
    await userEvent.click(screen.getByRole('button', { name: 'Novo' }));

    // submit sem nome: nada
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(m.post).not.toHaveBeenCalled();

    await userEvent.type(screen.getByPlaceholderText('Nome *'), 'Novo');
    // e-mail inválido p/ o EMAIL_RE (exige ponto) mas válido p/ o input type=email
    await userEvent.type(screen.getByPlaceholderText('E-mail'), 'a@b');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(toastMock.error).toHaveBeenCalledWith('E-mail inválido.');
    expect(m.post).not.toHaveBeenCalled();

    // corrige e-mail, escolhe representada, telefone com máscara
    await userEvent.clear(screen.getByPlaceholderText('E-mail'));
    await userEvent.type(screen.getByPlaceholderText('E-mail'), 'novo@x.com');
    await userEvent.selectOptions(screen.getByRole('combobox'), '5');
    await userEvent.type(screen.getByPlaceholderText('Telefone'), '48999998888');
    await userEvent.type(screen.getByPlaceholderText(/Cargo/), 'Gerente');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(m.post).toHaveBeenCalledWith('/api/contacts', expect.objectContaining({ nome: 'Novo', represented_id: 5 })));
    expect(toastMock.success).toHaveBeenCalledWith('Contato criado.');
  });

  it('vincula, troca e remove a empresa-prospect do contato', async () => {
    m.post.mockResolvedValueOnce({ contact: contact({ id: 21, nome: 'Com Empresa', company_id: 99, company_name: 'RS Marca' }) });
    render(<Settings />);
    await go(/Contatos/);
    await screen.findByText('Nenhum contato');
    await userEvent.click(screen.getByRole('button', { name: 'Novo' }));
    await userEvent.type(screen.getByPlaceholderText('Nome *'), 'Com Empresa');

    // escolhe empresa via CompanySearch -> vira chip com nome fantasia
    await userEvent.click(screen.getByRole('button', { name: 'mock-pick' }));
    expect(await screen.findByText('RS Marca')).toBeInTheDocument();

    // remove -> volta o buscador
    await userEvent.click(screen.getByLabelText('Remover empresa'));
    expect(screen.getByRole('button', { name: 'mock-pick' })).toBeInTheDocument();

    // escolhe de novo e salva -> company_id vai no body
    await userEvent.click(screen.getByRole('button', { name: 'mock-pick' }));
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(m.post).toHaveBeenCalledWith('/api/contacts', expect.objectContaining({ nome: 'Com Empresa', company_id: 99 })));

    // badge da empresa aparece na lista
    expect(await screen.findByText('RS Marca')).toBeInTheDocument();
  });

  it('edição de contato pré-carrega a empresa vinculada', async () => {
    contacts = [contact({ company_id: 99, company_name: 'RS Marca' })];
    m.patch.mockResolvedValueOnce({ contact: contact({ company_id: null, company_name: null }) });
    render(<Settings />);
    await go(/Contatos/);
    // badge na linha
    expect(await screen.findByText('RS Marca')).toBeInTheDocument();

    // abre edição: chip preenchido; remove e salva -> company_id null no body
    await userEvent.click(screen.getAllByLabelText('Editar')[0]!);
    await userEvent.click(screen.getByLabelText('Remover empresa'));
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(m.patch).toHaveBeenCalledWith('/api/contacts/10', expect.objectContaining({ company_id: null })));
  });

  it('erro ao criar contato', async () => {
    m.post.mockRejectedValueOnce(new Error('c-fail'));
    render(<Settings />);
    await go(/Contatos/);
    await screen.findByText('Nenhum contato');
    await userEvent.click(screen.getByRole('button', { name: 'Novo' }));
    await userEvent.type(screen.getByPlaceholderText('Nome *'), 'X');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith('c-fail'));

    // cancela o formulário novo (onCancel)
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByPlaceholderText('Nome *')).not.toBeInTheDocument();
  });

  it('lista, edita e exclui contatos (com badges de cargo/representada)', async () => {
    reps = [rep];
    contacts = [contact(), contact({ id: 12, nome: 'Sem vinculo', cargo: null, email: null, telefone: null, represented_id: null })];
    m.patch.mockResolvedValueOnce({ contact: contact({ nome: 'Maria editada' }) });
    m.del.mockResolvedValueOnce({});
    render(<Settings />);
    await go(/Contatos/);
    expect(await screen.findByText('Maria')).toBeInTheDocument();
    expect(screen.getByText('Compradora')).toBeInTheDocument();
    expect(screen.getByText('ACME')).toBeInTheDocument();
    expect(screen.getByText('sem contato')).toBeInTheDocument();

    // editar -> patch
    await userEvent.click(screen.getAllByLabelText('Editar')[0]!);
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(m.patch).toHaveBeenCalledWith('/api/contacts/10', expect.objectContaining({ nome: 'Maria' })));
    expect(toastMock.success).toHaveBeenCalledWith('Contato salvo.');

    // excluir
    await userEvent.click(screen.getAllByLabelText('Excluir')[0]!);
    await waitFor(() => expect(m.del).toHaveBeenCalledWith('/api/contacts/10'));
    expect(toastMock.success).toHaveBeenCalledWith('Contato excluído.');
  });

  it('erros de edição/exclusão de contato', async () => {
    contacts = [contact()];
    render(<Settings />);
    await go(/Contatos/);
    await screen.findByText('Maria');

    // update falha
    m.patch.mockRejectedValueOnce(new Error('cu-fail'));
    await userEvent.click(screen.getAllByLabelText('Editar')[0]!);
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith('cu-fail'));
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));

    // delete cancelado
    confirmMock.mockResolvedValueOnce(false);
    await userEvent.click(screen.getAllByLabelText('Excluir')[0]!);
    expect(m.del).not.toHaveBeenCalled();

    // delete falha
    m.del.mockRejectedValueOnce(new Error('cd'));
    await userEvent.click(screen.getAllByLabelText('Excluir')[0]!);
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith('Não foi possível excluir o contato.'));
  });

  it('gating: sem permissões esconde ações', async () => {
    contacts = [contact()];
    setAuth({ can: () => false });
    render(<Settings />);
    await go(/Contatos/);
    await screen.findByText('Maria');
    expect(screen.queryByRole('button', { name: 'Novo' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Editar')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Excluir')).not.toBeInTheDocument();
  });
});
