# Vértice — Identidade Visual

Guia para aplicar a marca com consistência. Stack já usa **Tailwind v4**; os tokens abaixo
entram em `@theme`.

---

## 1. Logo

Arquivos em `Marketing/`:

- `logo.svg` — versão principal (colorida): badge índigo + radar âmbar/teal + pin branco + wordmark (o "é" em âmbar).
- `logo-mono.svg` — monocromática (índigo sólido) para fundo claro / impressão 1 cor.
- `favicon.svg` — só o símbolo, para aba do navegador / ícone do aplicativo.

**Conceito:** o badge é o **vértice** — o ponto onde tudo converge. Dentro, um **pin**
(a empresa-alvo) no centro de **anéis de radar** (proximidade) com **nós** vizinhos (clientes
da carteira) apontando para ele. Resume a marca: prospecção, pedido, comissão e campo
convergindo num só ponto — encontrar a empresa certa, no lugar certo, dentro da sua praça.

### Regras
- **Área de proteção:** margem mínima = altura da letra "P" do wordmark em todos os lados.
- **Tamanho mínimo:** símbolo isolado 24 px; lockup horizontal 120 px de largura.
- **Fundo:** versão colorida em fundo claro (`#F8FAFC`/branco) ou no índigo (vira o `logo-mono`
  com pin branco). Garantir contraste; nunca sobre foto sem painel sólido atrás.

### Não fazer
- Não distorcer/esticar, não rotacionar, não trocar as cores do badge, não aplicar sombra
  forte, não recolorir o pin para algo sem contraste, não usar o wordmark sem o símbolo em
  contextos de marca (favicon/app pode usar só o símbolo).

---

## 2. Paleta

Premium B2B: índigo profundo transmite **confiança e solidez**; o âmbar é o **valor/comissão**
(dinheiro, energia de venda) e funciona como cor de ação; o teal marca **atividade/cobertura**
no mapa (sem competir com vermelho de erro).

| Papel | Token | HEX | Uso |
|-------|-------|-----|-----|
| Primária | `--color-primary` | `#1B2559` | Marca, header, texto forte, fundo hero |
| Primária 600 | `--color-primary-600` | `#27357A` | Hover, gradientes |
| Acento (CTA) | `--color-accent` | `#E8A23D` | Botões primários, comissão, destaques |
| Acento 600 | `--color-accent-600` | `#CC8A28` | Hover do CTA |
| Secundária | `--color-teal` | `#14B8A6` | Ativo no mapa, cobertura, badges positivos |
| Sucesso | `--color-success` | `#16A34A` | Confirmação, meta batida |
| Alerta | `--color-warning` | `#FB923C` | Inatividade, estagnação |
| Erro | `--color-error` | `#DC2626` | Erro crítico, falha |
| Texto forte | `--color-slate-900` | `#0F172A` | Títulos no claro |
| Texto médio | `--color-slate-600` | `#475569` | Corpo |
| Borda | `--color-slate-200` | `#E2E8F0` | Linhas, cards |
| Fundo | `--color-slate-50` | `#F8FAFC` | Fundo de página |

### Tokens Tailwind v4 (`@theme`)

```css
@theme {
  --color-primary:      #1B2559;
  --color-primary-600:  #27357A;
  --color-accent:       #E8A23D;
  --color-accent-600:   #CC8A28;
  --color-teal:         #14B8A6;
  --color-success:      #16A34A;
  --color-warning:      #FB923C;
  --color-error:        #DC2626;
  --color-slate-900:    #0F172A;
  --color-slate-600:    #475569;
  --color-slate-200:    #E2E8F0;
  --color-slate-50:     #F8FAFC;

  --font-display: "Sora", system-ui, sans-serif;
  --font-sans:    "Inter", system-ui, sans-serif;
}
```

Gradiente de marca (hero/badge): `linear-gradient(135deg, #27357A 0%, #1B2559 100%)`.

---

## 3. Tipografia

- **Display / títulos:** **Sora** (geométrica, premium, moderna) — pesos 600/700.
- **Corpo / UI:** **Inter** — 400/500/600. Já comum em apps; ótima leitura em tabela densa
  (sistema de gestão tem muita tabela densa).
- Ambas gratuitas (Google Fonts). Carregar só os pesos usados.

Escala (web):

| Nível | Tamanho / peso | Fonte |
|-------|----------------|-------|
| H1 hero | 56–64px / 700 | Sora |
| H2 | 36px / 700 | Sora |
| H3 | 24px / 600 | Sora |
| Corpo | 16–18px / 400 | Inter |
| Pequeno / label | 13–14px / 500 | Inter |

`letter-spacing` levemente negativo (-0.02em) nos títulos grandes Sora.

---

## 4. Elementos de apoio

- **Cards:** fundo branco, borda `slate-200`, raio 16px, sombra suave.
- **Botão primário:** fundo `accent`, texto `primary` (#1B2559) — alto contraste, "clica aqui";
  hover `accent-600`.
- **Botão secundário:** contorno `primary`, texto `primary`, fundo transparente.
- **Mapa:** base clara (CARTO Positron), marcadores `teal` para cobertura, pin `accent` para
  o alvo recomendado — espelha o símbolo da marca.
- **Iconografia:** linha (stroke ~1.75px), cantos levemente arredondados, conjunto único
  (ex. Lucide) para consistência com a UI.
