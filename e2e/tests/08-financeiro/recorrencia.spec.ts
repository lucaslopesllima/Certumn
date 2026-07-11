import { test, expect, ApiClient } from '../../fixtures/index.ts';

test.describe('financeiro — recorrência', () => {
  test('lançamento recorrente mensal já materializa os meses decorridos na criação', async ({ page, request, loginAs }) => {
    const session = await loginAs('financeiro-recorrencia');
    void page;
    const api = new ApiClient(request, session);
    const passado = new Date();
    passado.setMonth(passado.getMonth() - 2);
    // POST /api/finance já chama materializeRecurrences() na hora (finance.ts:
    // "if (b.recorrencia === 'mensal') await materializeRecurrences(orgId)") —
    // rodar /finance/recurrences/run de novo em seguida não acha nada de novo
    // (idempotente), então o efeito observável já está nas entries logo após o create.
    await api.post('/api/finance', {
      kind: 'pagar', descricao: 'Aluguel E2E', valor: 1000,
      vencimento: passado.toISOString().slice(0, 10), recorrencia: 'mensal',
    });

    const list = await api.get<{ entries: { descricao: string }[] }>('/api/finance?limit=500');
    const ocorrencias = list.entries.filter((e) => e.descricao === 'Aluguel E2E');
    expect(ocorrencias.length).toBeGreaterThanOrEqual(2); // origem + ao menos 1 filho materializado

    // rodar o endpoint manual de novo é idempotente: não cria duplicatas.
    const r = await api.post<{ created: number }>('/api/finance/recurrences/run');
    expect(r.created).toBe(0);
  });
});
