import { useEffect, useState } from 'react';
import { api, ApiError } from './api.ts';
import type { CompanyDetail, Socio } from './types.ts';
import { Spinner } from './ui.tsx';
import { Icon } from './icons.tsx';
import { Cnae, seedCnae } from './cnae.tsx';
import { waLink } from './format.ts';
import { toast } from './toast.tsx';

// Modal só-leitura com TODOS os dados da empresa no banco (RFB) + quadro societário.
const PORTE_LABEL: Record<string, string> = {
  nao_informado: 'Não informado', micro: 'Microempresa', pequeno: 'Pequeno porte', demais: 'Demais',
};
const FAIXA_ETARIA: Record<number, string> = {
  1: '0 a 12', 2: '13 a 20', 3: '21 a 30', 4: '31 a 40', 5: '41 a 50',
  6: '51 a 60', 7: '61 a 70', 8: '71 a 80', 9: 'Mais de 80',
};
const SOCIO_TIPO: Record<number, string> = { 1: 'Pessoa jurídica', 2: 'Pessoa física', 3: 'Estrangeiro' };
const PRECISAO_LABEL: Record<string, string> = {
  rua: 'endereço', rua_aprox: 'rua (aprox.)', cep: 'CEP', municipio: 'município',
};

const fmtCnpj = (s: string): string =>
  s.length === 14 ? s.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : s;
const fmtBrl = (n: number): string => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtCep = (s: string): string => (s.length === 8 ? s.replace(/^(\d{5})(\d{3})$/, '$1-$2') : s);
const fmtData = (s: string | null): string | null =>
  s ? (/^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10).split('-').reverse().join('/') : s) : null;
const fmtSimNao = (s: string | null): string | null => (s === 'S' ? 'Sim' : s === 'N' ? 'Não' : null);
const fmtTel = (s: string | null): string | null => {
  if (!s) return null;
  const d = s.replace(/\D/g, '');
  return d.length >= 10 ? `(${d.slice(0, 2)}) ${d.slice(2)}` : s;
};
function fmtEndereco(c: CompanyDetail): string {
  const linha1 = [c.logradouro, c.numero].filter(Boolean).join(', ');
  const partes = [linha1, c.complemento, c.bairro, c.cep ? `CEP ${fmtCep(c.cep)}` : null].filter(Boolean);
  return partes.join(' · ');
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex flex-col border-b border-ink-100 py-2 last:border-0 sm:flex-row sm:gap-3">
      <span className="w-44 shrink-0 text-xs font-medium text-ink-400">{label}</span>
      <span className="text-sm text-ink-700">{value || <span className="text-ink-300">—</span>}</span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="mt-4 first:mt-0">
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-400">{title}</p>
      {children}
    </div>
  );
}

function SociosBloco({ socios }: { socios: Socio[] }): React.JSX.Element {
  if (!socios.length) return <p className="text-sm text-ink-300">Nenhum sócio informado.</p>;
  return (
    <div className="divide-y divide-ink-100">
      {socios.map((s, i) => (
        <div key={i} className="py-2">
          <p className="text-sm font-medium text-ink-700">{s.nome || '—'}</p>
          <p className="text-xs text-ink-400">
            {[s.qualificacao_descricao,
              s.identificador != null ? SOCIO_TIPO[s.identificador] : null,
              s.cnpj_cpf || null,
              s.data_entrada ? `desde ${fmtData(s.data_entrada)}` : null,
              s.faixa_etaria ? `${FAIXA_ETARIA[s.faixa_etaria] ?? ''} anos` : null,
            ].filter(Boolean).join(' · ')}
          </p>
          {s.nome_representante && (
            <p className="text-xs text-ink-400">Repr.: {s.nome_representante}</p>
          )}
        </div>
      ))}
    </div>
  );
}

export function CompanyModal({ companyId, onClose }: { companyId: number; onClose: () => void }): React.JSX.Element {
  const [data, setData] = useState<CompanyDetail | null>(null);
  const [socios, setSocios] = useState<Socio[]>([]);
  const [geo, setGeo] = useState<{ lat: number; lon: number; precisao: string } | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    setData(null); setSocios([]); setGeo(null); setErr(false);
    void api.get<{ company: CompanyDetail; socios: Socio[] }>(`/api/companies/${companyId}`)
      .then((r) => {
        setData(r.company); setSocios(r.socios ?? []);
        seedCnae(r.company.cnae_principal, r.company.cnae_descricao); // já temos a descrição
        if (r.company.geo_lat != null && r.company.geo_lon != null) {
          setGeo({ lat: r.company.geo_lat, lon: r.company.geo_lon, precisao: r.company.geo_precisao ?? 'rua' });
        } else {
          // geocodifica o endereço sob demanda (cacheia no banco)
          void api.get<{ geocode: { lat: number; lon: number; precisao: string } }>(`/api/companies/${companyId}/geocode`)
            .then((gr) => setGeo(gr.geocode)).catch(() => undefined);
        }
      }).catch(() => setErr(true));
  }, [companyId]);

  const raw = data?.raw_data && Object.keys(data.raw_data).length > 0 ? data.raw_data : null;

  // Telefone formatado que abre a conversa direto na tela do WhatsApp (cria/vincula
  // o chat pela empresa), mesmo comportamento do funil — não usa mais o wa.me externo.
  const telWa = (s: string | null): React.ReactNode => {
    const fmt = fmtTel(s);
    if (!fmt) return null;
    if (!waLink(s)) return fmt;
    return (
      <button type="button" title="Abrir conversa no WhatsApp"
        onClick={() => {
          void api.post<{ chat: { id: number } }>('/api/whatsapp/chats/from-company', { company_id: companyId, numero: s! })
            .then((r) => { window.location.href = `/whatsapp?chat=${r.chat.id}`; })
            .catch((e) => toast.error(e instanceof ApiError ? e.message : 'Falha ao abrir WhatsApp'));
        }}
        className="inline-flex items-center gap-1 text-emerald-600 hover:underline">
        {fmt}<Icon name="whatsapp" size={13} />
      </button>
    );
  };

  return (
    <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-black/45 p-4" onClick={onClose}>
      <div className="flex max-h-[90vh] w-full max-w-xl flex-col rounded-2xl border border-ink-200 bg-surface shadow-pop"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-3 border-b border-ink-100 p-5">
          <h2 className="inline-flex items-center gap-2 text-base font-semibold text-ink-800">
            <Icon name="building" size={18} className="text-ink-400" /> Dados da empresa
          </h2>
          <button type="button" onClick={onClose}
            className="rounded-lg p-1 text-ink-400 transition hover:bg-ink-100 hover:text-ink-700">
            <Icon name="x" size={18} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {err ? (
            <p className="py-8 text-center text-sm text-ink-400">Não foi possível carregar.</p>
          ) : !data ? (
            <div className="py-8"><Spinner /></div>
          ) : (
            <>
              <Section title="Identificação">
                <InfoRow label="Razão social" value={data.razao_social} />
                <InfoRow label="Nome fantasia" value={data.nome_fantasia} />
                <InfoRow label="CNPJ" value={fmtCnpj(data.cnpj)} />
                <InfoRow label="Matriz / Filial" value={data.matriz_filial === 1 ? 'Matriz' : data.matriz_filial === 2 ? 'Filial' : null} />
                <InfoRow label="Natureza jurídica" value={data.natureza_descricao ?? (data.natureza_juridica?.toString() || null)} />
                <InfoRow label="Porte" value={PORTE_LABEL[data.porte] ?? data.porte} />
                <InfoRow label="Capital social" value={fmtBrl(Number(data.capital_social))} />
              </Section>

              <Section title="Atividade">
                <InfoRow label="CNAE principal" value={<Cnae code={data.cnae_principal} full />} />
                <InfoRow label="CNAEs secundários" value={data.cnae_secundarios?.length
                  ? <span className="flex flex-col gap-y-1">{data.cnae_secundarios.map((cod) => <Cnae key={cod} code={cod} full />)}</span>
                  : null} />
                <InfoRow label="Início de atividade" value={fmtData(data.data_inicio_atividade)} />
              </Section>

              <Section title="Endereço">
                <InfoRow label="Endereço" value={fmtEndereco(data)} />
                <InfoRow label="Cidade / UF" value={[data.cidade, data.uf].filter(Boolean).join(' · ')} />
                <InfoRow label="Região" value={data.regiao} />
                <InfoRow label="Cidade exterior" value={data.nome_cidade_exterior} />
                <InfoRow label="País" value={data.pais_nome ?? (data.pais?.toString() || null)} />
                <InfoRow label="Localização" value={geo
                  ? `${geo.lat.toFixed(5)}, ${geo.lon.toFixed(5)} · ${PRECISAO_LABEL[geo.precisao] ?? geo.precisao}`
                  : <span className="text-ink-300">localizando…</span>} />
              </Section>

              <Section title="Contato">
                <InfoRow label="Telefone 1" value={telWa(data.telefone1)} />
                <InfoRow label="Telefone 2" value={telWa(data.telefone2)} />
                <InfoRow label="Fax" value={fmtTel(data.fax)} />
                <InfoRow label="E-mail" value={data.email} />
              </Section>

              <Section title="Situação cadastral">
                <InfoRow label="Situação" value={data.situacao_cadastral} />
                <InfoRow label="Data da situação" value={fmtData(data.data_situacao_cadastral)} />
                <InfoRow label="Motivo" value={data.motivo_descricao ?? (data.motivo_situacao?.toString() || null)} />
                <InfoRow label="Situação especial" value={data.situacao_especial} />
                <InfoRow label="Data sit. especial" value={fmtData(data.data_situacao_especial)} />
              </Section>

              <Section title="Tributário">
                <InfoRow label="Opção Simples" value={fmtSimNao(data.opcao_simples)} />
                <InfoRow label="Entrada Simples" value={fmtData(data.data_opcao_simples)} />
                <InfoRow label="Saída Simples" value={fmtData(data.data_exclusao_simples)} />
                <InfoRow label="MEI" value={fmtSimNao(data.opcao_mei)} />
                <InfoRow label="Entrada MEI" value={fmtData(data.data_opcao_mei)} />
                <InfoRow label="Saída MEI" value={fmtData(data.data_exclusao_mei)} />
              </Section>

              <Section title={`Quadro societário${socios.length ? ` (${socios.length})` : ''}`}>
                <SociosBloco socios={socios} />
              </Section>

              <Section title="Outros">
                <InfoRow label="Resp. (qualificação)" value={data.qualificacao_descricao ?? (data.qualificacao_responsavel?.toString() || null)} />
                <InfoRow label="Ente federativo" value={data.ente_federativo} />
                <InfoRow label="Fonte" value={data.source} />
              </Section>

              {raw && (
                <div className="mt-4">
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-400">Dados brutos (RFB)</p>
                  <pre className="overflow-x-auto rounded-xl bg-ink-50 p-3 text-xs text-ink-600">{JSON.stringify(raw, null, 2)}</pre>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
