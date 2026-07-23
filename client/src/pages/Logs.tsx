import { useEffect, useState } from 'react';
import { api, ApiError } from '../lib/api.ts';
import type { AuditEntry } from '../lib/types.ts';
import { Badge, Btn, Card, EmptyState, PageHeader, Spinner, cn } from '../lib/ui.tsx';
import { Icon } from '../lib/icons.tsx';
import type { Tone } from '../lib/ui.tsx';

const PAGE_SIZE = 50;

// Rótulos em PT das entidades/ações que a trilha grava (server/src/audit.ts).
// Fallback pro código cru: entidade/ação nova aparece mesmo sem tradução — nada
// some da tela só por faltar rótulo.
const ENTIDADE: Record<string, string> = {
  activity: 'Atividade', carrier: 'Transportadora', commission: 'Comissão',
  commission_rule: 'Regra de comissão', email_schedule: 'E-mail agendado',
  email_template: 'Modelo de e-mail', finance: 'Financeiro', finance_category: 'Categoria financeira',
  goal: 'Meta', group: 'Grupo de usuários', order: 'Pedido', org_smtp_settings: 'SMTP',
  org_whatsapp_settings: 'WhatsApp', organization: 'Organização', price_table: 'Tabela de preço',
  relationship: 'Cliente (funil)', sample_request: 'Amostra', user: 'Usuário', whatsapp_chat: 'Conversa WhatsApp',
};
const ACAO: Record<string, { label: string; tone: Tone }> = {
  create: { label: 'Criou', tone: 'success' },
  update: { label: 'Alterou', tone: 'info' },
  delete: { label: 'Excluiu', tone: 'danger' },
  import: { label: 'Importou', tone: 'brand' },
  link: { label: 'Vinculou', tone: 'info' },
  link_contact: { label: 'Vinculou contato', tone: 'info' },
  merge: { label: 'Mesclou', tone: 'info' },
  transfer: { label: 'Transferiu', tone: 'warn' },
  transition: { label: 'Moveu etapa', tone: 'info' },
  settle: { label: 'Baixou', tone: 'success' },
  checkin: { label: 'Check-in', tone: 'success' },
  report: { label: 'Registrou visita', tone: 'info' },
  connect: { label: 'Conectou', tone: 'success' },
  disconnect: { label: 'Desconectou', tone: 'warn' },
  reset_password: { label: 'Resetou senha', tone: 'warn' },
  upgrade_tipo_conta: { label: 'Mudou plano', tone: 'brand' },
};

function entidadeLabel(e: string): string { return ENTIDADE[e] ?? e; }
function acaoInfo(a: string): { label: string; tone: Tone } { return ACAO[a] ?? { label: a, tone: 'neutral' }; }

function quemFez(e: AuditEntry): string {
  return e.user_nome ?? e.user_email ?? 'Sistema';
}
function quando(iso: string): string {
  // data + hora local (a lista é cronológica reversa, hora importa).
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}
// diff é o recorte dos campos enviados na mutação (nunca senhas). Vazio/nulo não
// mostra nada; com conteúdo, abre num <details> pra não poluir a linha.
function temDiff(d: unknown): boolean {
  return d != null && typeof d === 'object' && Object.keys(d as object).length > 0;
}

export function Logs(): React.JSX.Element {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0); // 0-based
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [reload, setReload] = useState(0); // nonce: refaz o fetch sem trocar de página

  useEffect(() => {
    const ac = new AbortController();
    setLoading(true);
    setErr('');
    api.get<{ entries: AuditEntry[]; total: number }>(
      `/api/audit?limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}`, { signal: ac.signal },
    ).then(
      (r) => { setEntries(r.entries); setTotal(r.total); setLoading(false); },
      (e) => {
        if (ac.signal.aborted) return;
        setErr(e instanceof ApiError ? e.message : 'Falha ao carregar os logs');
        setLoading(false);
      },
    );
    return () => ac.abort();
  }, [page, reload]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const inicio = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const fim = Math.min((page + 1) * PAGE_SIZE, total);

  return (
    <div className="space-y-5 p-4 sm:p-6">
      <PageHeader
        title="Logs"
        subtitle="Registro de atividades da sua organização — quem fez o quê e quando."
      />

      <Card className="overflow-hidden">
        {loading ? (
          <Spinner />
        ) : err ? (
          <div className="flex flex-col items-center gap-3 py-12">
            <EmptyState icon="alertCircle" title={err} hint="Tente recarregar a página." />
            <Btn variant="ghost" size="sm" icon="arrowRight" onClick={() => setReload((n) => n + 1)}>Tentar de novo</Btn>
          </div>
        ) : entries.length === 0 ? (
          <EmptyState icon="clock" title="Nenhum log ainda" hint="As ações da equipe aparecem aqui conforme acontecem." />
        ) : (
          <ul className="divide-y divide-ink-100">
            {entries.map((e) => {
              const a = acaoInfo(e.action);
              return (
                <li key={e.id} className="flex flex-wrap items-start gap-x-3 gap-y-1.5 px-4 py-3 sm:px-5">
                  <Badge tone={a.tone} className="mt-0.5 shrink-0">{a.label}</Badge>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-ink-800">
                      <span className="font-semibold text-ink-900">{quemFez(e)}</span>
                      {' · '}
                      <span className="text-ink-600">{entidadeLabel(e.entity)}</span>
                      <span className="text-ink-400"> #{e.entity_id}</span>
                    </p>
                    {temDiff(e.diff) && (
                      <details className="mt-1 group">
                        <summary className="inline-flex cursor-pointer select-none items-center gap-1 text-xs text-ink-400 hover:text-ink-600">
                          <Icon name="chevronRight" size={13} className="transition-transform group-open:rotate-90" />
                          Detalhes
                        </summary>
                        <pre className="mt-1.5 max-w-full overflow-x-auto rounded-lg bg-ink-50 p-2.5 text-[12px] leading-relaxed text-ink-600">
                          {JSON.stringify(e.diff, null, 2)}
                        </pre>
                      </details>
                    )}
                  </div>
                  <time className="tabnums mt-0.5 shrink-0 whitespace-nowrap text-xs text-ink-400" dateTime={e.created_at}>
                    {quando(e.created_at)}
                  </time>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {!loading && !err && total > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="tabnums text-xs text-ink-400">
            {inicio}–{fim} de {total} registro{total === 1 ? '' : 's'}
          </p>
          <div className="flex items-center gap-2">
            <Btn variant="ghost" size="sm" icon="chevronLeft"
              disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>
              Anterior
            </Btn>
            <span className="tabnums text-xs text-ink-500">Página {page + 1} de {totalPages}</span>
            <Btn variant="ghost" size="sm" className={cn(page + 1 >= totalPages && 'opacity-50')}
              disabled={page + 1 >= totalPages} onClick={() => setPage((p) => p + 1)}>
              Próxima<Icon name="chevronRight" size={15} />
            </Btn>
          </div>
        </div>
      )}
    </div>
  );
}
