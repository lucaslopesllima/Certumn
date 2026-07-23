# Enriquecimento de dados de empresas

Estratégias para obter dados de empresas além do que a Receita Federal fornece:
contatos, e-mails, telefones, pessoas, cargos, LinkedIn, redes sociais e sinais comerciais.

---

## 1. Fontes de dados

### Grátis / raspável

| Fonte | O que entrega | Observação |
|---|---|---|
| **Site da empresa** | e-mail, telefone, WhatsApp, endereço, produtos | Raspar `/contato`, `/sobre`, `/quem-somos`, rodapé, `mailto:`, `tel:`, links `wa.me/55...`. Rodapé costuma trazer o CNPJ — confirma o match. |
| **registro.br (WHOIS)** | CNPJ do titular do domínio `.com.br` | **Casamento CNPJ ↔ domínio com certeza**, não heurística. Pulo do gato no Brasil. |
| **Google / Bing Search API** | descoberta de domínio, LinkedIn, redes | Serper.dev (~US$1/1000 queries), Brave Search API, SerpAPI. Query: `"RAZAO SOCIAL" contato email` ou `site:linkedin.com/company "nome fantasia"`. |
| **Google Maps / Places API** | telefone, site, horário, categoria real, fotos, reviews | Categoria do Places costuma ser melhor que o CNAE. Barato e excelente para PME. |
| **Instagram / Facebook** | bio com e-mail e WhatsApp | PME brasileira vive nessas redes. Graph API é limitada; achar via `site:instagram.com "nome"`. |
| **Juntas comerciais (JUCESP e estaduais)** | quadro societário histórico, capital social | |
| **Diário Oficial / DOU** | licitações, sócios, processos | |
| **Reclame Aqui** | porte real, canais de atendimento | |
| **CNEFE / IBGE** | geolocalização | Já integrado no Rovva (~93% da base com ponto real). |

### Pago

**Contatos e pessoas (internacional)**
- **Apollo.io** — API, pessoas + cargos, cobertura BR razoável.
- **Hunter.io** — melhor custo para "achar e-mail de pessoa X na empresa Y"; devolve o *pattern* (`nome.sobrenome@`) e verifica MX/SMTP.
- **Lusha**, **Snov.io**, **Dropcontact**, **Clearbit / Breeze** (HubSpot).

**Bases brasileiras**
- Econodata, Speedio, Cortex, Neoway, Casa dos Dados.
- CNPJá, ReceitaWS, BrasilAPI — base cadastral já normalizada, alguns com telefone/e-mail.

**LinkedIn**: scraping direto viola os Termos de Uso e resulta em bloqueio rápido.
Caminhos viáveis: Sales Navigator manual ou provider que já assume esse risco (Apollo, Lusha).

---

## 2. Métodos

### 2.1 Pipeline determinístico (fazer primeiro, sem IA)

```
CNPJ
  → razão social + nome fantasia + UF/município
  → busca web (Serper) → candidatos de domínio
  → valida domínio via WHOIS registro.br (CNPJ do titular bate?) → match forte
  → crawl do site (5–10 páginas) → regex de e-mail / telefone / WhatsApp / redes
  → Hunter ou Apollo pelo domínio → pessoas, cargos, padrão de e-mail
```

O WHOIS do `registro.br` expõe o CNPJ do titular do `.com.br`. É a forma mais confiável
de ligar empresa a domínio no Brasil, e o resto do pipeline depende disso.

### 2.2 IA onde a regex falha

- **Extração estruturada** — HTML limpo (readability) → LLM barato (Haiku) com `tool_use`
  e schema forçado, retornando:
  ```json
  {
    "emails": [],
    "telefones": [],
    "pessoas": [{ "nome": "", "cargo": "", "email": "" }],
    "descricao": "",
    "produtos": [],
    "porte_estimado": ""
  }
  ```
  Resolve casos que regex não pega: *"Fale com João Silva, Diretor Comercial — (11) 9..."*.

- **Desambiguação** — dados 5 resultados de busca, qual é a empresa certa? O LLM compara
  razão social + cidade + CNAE contra o snippet. Regex não resolve isso.

- **Classificação comercial** — o que a empresa realmente vende, aderência ao ICP e sinais
  de compra (está contratando? abrindo filial? expandindo?). Vira feature do score de
  recomendação.

- **Normalização de cargo** — "Sócio-Proprietário" / "Head de Suprimentos" / "Comprador"
  → nível hierárquico + flag de decisor de compra. Alimenta a priorização do representante.

### 2.3 Busca agêntica

A Messages API da Anthropic tem **web search** e **web fetch** server-side: o modelo busca
e lê sozinho, basta definir o schema de saída. Uma chamada resolve "acha contatos da
empresa X" sem crawler próprio. Custo por empresa é maior, então serve para
**enriquecimento sob demanda** (usuário clica "buscar dados"), não para a base inteira.

Alternativas: **Perplexity API**, **Exa.ai** (busca semântica feita para agente; tem
endpoint de *find similar companies*, ótimo para lookalike de ICP).

---

## 3. Arquitetura sugerida no Rovva

- **Tabela `company_enrichment` separada da cadastral**:
  `company_id, source, field, value, confidence, collected_at, raw_json`.
  Nunca sobrescrever o dado da Receita — camada por cima, com proveniência.

- **Fila de jobs** (pg-boss ou tabela `enrichment_jobs` + worker). Enriquecimento é lento
  e falha com frequência; não pode ser síncrono no request.

- **Cache por domínio, não por CNPJ** — matriz e filiais compartilham o mesmo site.

- **Tiering de custo**:
  - grátis para todos: Maps + crawl do site próprio;
  - pago (Apollo/Hunter): sob demanda, consumindo crédito do plano.

  Enriquecer 60M de CNPJs a US$0,01 é inviável. Enriquecer os 200 que o representante
  realmente prospecta custa US$2.

- **Confidence score por campo**, exibido na UI com a fonte
  ("e-mail do site oficial" vs "padrão inferido"). Aumenta a confiança do representante
  e protege o produto.

---

## 4. LGPD

- Dado de **pessoa jurídica** (CNPJ, e-mail `contato@`, telefone comercial): uso livre.
- Dado de **pessoa física** (nome, cargo, e-mail nominal, perfil LinkedIn) é dado pessoal,
  mesmo em contexto profissional. Base legal aplicável: **legítimo interesse**
  (art. 7º, IX da LGPD) para prospecção B2B. Exige:
  - origem do dado registrada;
  - opt-out simples e funcional;
  - não coletar dado sensível.
- Registrar sempre `source` e `collected_at` — é o que sustenta a defesa em fiscalização.
- Scraping de LinkedIn: risco jurídico e de bloqueio. Preferir provider licenciado.

---

## 5. Ordem de implementação recomendada

1. **WHOIS registro.br + crawler do site próprio** — maior ganho, custo zero,
   match confiável por CNPJ.
2. **Google Places** — telefone, site e categoria real.
3. **Extractor com LLM** (Haiku, schema forçado) sobre o HTML coletado.
4. **Apollo / Hunter sob demanda** — pessoas, cargos e e-mails nominais.
