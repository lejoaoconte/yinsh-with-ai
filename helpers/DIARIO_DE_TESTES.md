# Diário de Testes — Yinsh com IA

Registro de experimentos para determinar os **limites de viabilidade** dos algoritmos de busca implementados no jogo Yinsh.

---

## Algoritmos testados

- `αβ d=N` — Minimax com poda Alpha-Beta, profundidade N
- `MM d=N` — Minimax com Antecipação Limitada (sem poda), profundidade N
- `MM d=0` — Jogada aleatória (colocação inicial de anéis)

---

## Teste 1 — Alpha-Beta, profundidade 3

**Configuração:** αβ d=3 · Brancas (○) vs Pretas (●)  
**Total de jogadas registradas:** 64

### Resumo — αβ d=3

- **Tempo mínimo:** 13 ms (jogada 64, fase inicial)
- **Tempo máximo:** 1.607 ms (jogada 24)
- **Tempo médio (fase de jogo):** ~350 ms
- **Nós máximos avaliados:** 22.139 (jogada 24)
- **Pico de Heap Δ:** 12.26 MB (jogada 61)
- **Conclusão:** ✅ **Viável.** Todas as jogadas respondem em menos de 2 segundos. Experiência de jogo fluida.

---

## Teste 2 — Alpha-Beta, profundidade 5

**Configuração:** αβ d=5 · Brancas (○) vs Pretas (●)  
**Total de jogadas registradas:** 90

### Resumo — αβ d=5

- **Tempo mínimo:** 16 ms (jogada 90, fase inicial)
- **Tempo máximo:** 505.903 ms (~8,4 min — jogada 16)
- **Pico de nós avaliados:** 2.805.123 (jogada 16)
- **Pico de Heap Δ:** 10.98 MB (jogada 77)
- **Jogadas acima de 30 s:** jogadas 43 (151 s), 31 (151 s), 19 (243 s), 17 (335 s), 16 (505 s)
- **Conclusão:** ⚠️ **Limite de viabilidade atingido.** As jogadas do meio do jogo (nós 15–31) ficam proibitivamente lentas. Inviável para uso interativo.

---

## Teste 3 — Antecipação Limitada (MM), profundidade 3

**Configuração:** MM d=3 · Brancas (○) vs Pretas (●)  
**Total de jogadas registradas:** 69

### Resumo — MM d=3

- **Tempo mínimo:** 25 ms (fase inicial)
- **Tempo máximo:** 5.519 ms (jogada 9)
- **Tempo médio (fase de jogo):** ~1.500 ms
- **Nós máximos avaliados:** 551.286 (jogada 3)
- **Pico de Heap Δ:** 11.40 MB (jogada 8)
- **Comparação com αβ d=3:** MM d=3 avalia **~25× mais nós** na fase inicial (551k vs 22k) e leva **~4× mais tempo** no pior caso
- **Conclusão:** ⚠️ **Limítrofe.** Jogável, mas com latências perceptíveis (2–5 s) na fase de colocação de anéis. A ausência de poda é claramente sentida.

---

## Teste 4 — Antecipação Limitada (MM), profundidade 4

**Configuração:** MM d=4 · Brancas (○) vs Pretas (●)  
**Total de jogadas registradas:** 78

### Resumo — MM d=4

- **Tempo mínimo:** 29 ms (fase inicial)
- **Tempo máximo:** 332.192 ms (~5,5 min — jogada 9)
- **Nós máximos avaliados:** 44.102.880 (jogada 3 — fase de colocação)
- **Pico de Heap Δ:** 4.21 MB (jogada 74)
- **Jogadas acima de 1 min:** jogadas 3–21 (fase de colocação de anéis e início de jogo)
- **Conclusão:** ❌ **Inviável.** A ausência de poda com d=4 explode o número de nós para dezenas de milhões já nas primeiras jogadas. Completamente impraticável para uso interativo.

---

## Comparativo geral

| Algoritmo | Profundidade | Tempo médio | Pior caso | Nós (pior) | Viabilidade |
|---|---|---|---|---|---|
| αβ | d=3 | ~350 ms | 1.607 ms | 22.139 | ✅ Viável |
| αβ | d=5 | ~15.000 ms | 505.903 ms | 2.805.123 | ⚠️ Limite |
| MM | d=3 | ~1.500 ms | 5.519 ms | 551.286 | ⚠️ Limítrofe |
| MM | d=4 | ~60.000 ms | 332.192 ms | 44.102.880 | ❌ Inviável |

## Conclusões

1. **Alpha-Beta d=3** é a configuração mais equilibrada: rápida (~350 ms médio), responsiva e com qualidade de jogo adequada.

2. **Alpha-Beta d=5** atinge um limite crítico no meio do jogo (jogadas 15–31), com picos acima de 5 minutos por jogada — inviável para uso interativo, mas pode ser usado em análise offline.

3. **MM d=3 sem poda** avalia ~25× mais nós que αβ d=3 para o mesmo resultado — confirma empiricamente a eficácia da poda Alpha-Beta.

4. **MM d=4 sem poda** é completamente inviável: dezenas de milhões de nós por jogada, com tempos de 1–5 minutos já nas primeiras rodadas.

5. A **poda α-β** é indispensável para qualquer profundidade ≥ 3. Sem ela, o crescimento de nós é $O(b^d)$ puro — cada nível adicional multiplica o trabalho pelo fator de ramificação do Yinsh.
