# DOCUMENTATION — yinsh-with-ai

Documentação técnica completa das funcionalidades do jogo YINSH implementado em TypeScript/React. Esta documentação cobre em profundidade os quatro módulos centrais da lógica de jogo e de análise de estados:

- [`GameMechanics.ts`](#1-gamemechanicsts) — motor do jogo
- [`GameStateTree.ts`](#2-gamestatetreets) — árvore de estados / análise de partida
- [`useGameTree.ts`](#3-usegametreehookts) — hook React que sincroniza a árvore com a UI
- [`useYinshGame.ts`](#4-useyinshgamehookts) — hook React que gerencia o estado do jogo para o tabuleiro

---

## Índice

1. [GameMechanics.ts](#1-gamemechanicsts)
   - 1.1 [Tipos e Interfaces](#11-tipos-e-interfaces)
   - 1.2 [Sistema de Coordenadas Hexagonais](#12-sistema-de-coordenadas-hexagonais)
   - 1.3 [Posições Válidas do Tabuleiro](#13-posições-válidas-do-tabuleiro)
   - 1.4 [Classe YinshGame](#14-classe-yinshgame)
   - 1.5 [Fases do Jogo — Fluxo Completo](#15-fases-do-jogo--fluxo-completo)
   - 1.6 [Cálculo de Movimentos Válidos](#16-cálculo-de-movimentos-válidos)
   - 1.7 [Ações do Jogador](#17-ações-do-jogador)
   - 1.8 [Detecção de Sequências (Runs)](#18-detecção-de-sequências-runs)
   - 1.9 [Flip de Marcadores](#19-flip-de-marcadores)
   - 1.10 [Verificação de Vitória e Empate](#110-verificação-de-vitória-e-empate)
2. [GameStateTree.ts](#2-gamestatetreets)
   - 2.1 [Serialização de Estado](#21-serialização-de-estado)
   - 2.2 [Hash de Estado (djb2)](#22-hash-de-estado-djb2)
   - 2.3 [Estrutura do Nó da Árvore](#23-estrutura-do-nó-da-árvore)
   - 2.4 [Geração de Estados Filhos](#24-geração-de-estados-filhos)
   - 2.5 [Classe GameStateTree](#25-classe-gamestatetree)
   - 2.6 [Inicialização da Árvore](#26-inicialização-da-árvore)
   - 2.7 [Registro de Jogada (applyMove)](#27-registro-de-jogada-applymove)
   - 2.8 [Desfazer Jogada (undo)](#28-desfazer-jogada-undo)
   - 2.9 [Navegação para Nó Específico (navigateTo)](#29-navegação-para-nó-específico-navigateto)
   - 2.10 [IDs Navegáveis (getNavigableIds)](#210-ids-navegáveis-getnavigableids)
   - 2.11 [Expansão de Filhos (_expandChildren)](#211-expansão-de-filhos-_expandchildren)
   - 2.12 [Serialização XML (toXML / fromXML)](#212-serialização-xml-toxml--fromxml)
   - 2.13 [Persistência em Arquivo](#213-persistência-em-arquivo)
   - 2.14 [Propriedades Computadas](#214-propriedades-computadas)
3. [useGameTree.ts](#3-usegametreehookts)
   - 3.1 [Estado Interno e Estratégia de Re-render](#31-estado-interno-e-estratégia-de-re-render)
   - 3.2 [recordMove](#32-recordmove)
   - 3.3 [resetTree](#33-resettree)
   - 3.4 [undoMove](#34-undomove)
   - 3.5 [saveTree / loadTree](#35-savetree--loadtree)
   - 3.6 [navigateToNode](#36-navigatetonode)
4. [useYinshGame.ts](#4-useyinshgamehookts)
   - 4.1 [Estado Central](#41-estado-central)
   - 4.2 [performAction](#42-performaction)
   - 4.3 [Nós do Tabuleiro (BoardNode)](#43-nós-do-tabuleiro-boardnode)
   - 4.4 [Arestas do Tabuleiro (BoardEdge)](#44-arestas-do-tabuleiro-boardedge)
   - 4.5 [Movimentos Válidos](#45-movimentos-válidos)
   - 4.6 [handleCellClick](#46-handlecellclick)
   - 4.7 [resetGame](#47-resetgame)
   - 4.8 [runCoords](#48-runcoords)
5. [Fluxo de Dados Entre os Módulos](#5-fluxo-de-dados-entre-os-módulos)
6. [Diagrama de Fases do Jogo](#6-diagrama-de-fases-do-jogo)

---

## 1. GameMechanics.ts

Este arquivo é o **motor completo do jogo YINSH**. Contém toda a lógica de regras, validação de movimentos, detecção de vitória e representação do estado. Não depende de React nem de nenhuma biblioteca externa.

---

### 1.1 Tipos e Interfaces

#### `Player`
```typescript
type Player = "white" | "black";
```
Representa os dois jogadores. Usado em todo o estado para indicar de quem é a vez, quem possui cada peça, quem está removendo sequências, etc.

---

#### `CellContent`
```typescript
type CellContent = null | "W_RING" | "B_RING" | "W_MARKER" | "B_MARKER";
```
O conteúdo de cada célula do tabuleiro:
- `null` — célula vazia
- `"W_RING"` — anel branco (peça do jogador branco que se move pelo tabuleiro)
- `"B_RING"` — anel preto
- `"W_MARKER"` — marcador branco (peça que fica fixa no tabuleiro após o anel ser movido)
- `"B_MARKER"` — marcador preto

---

#### `GamePhase`
```typescript
type GamePhase =
  | "placing-rings"
  | "place-marker"
  | "move-ring"
  | "remove-run"
  | "remove-ring"
  | "game-over";
```
Enum das 6 fases possíveis do jogo. A transição entre fases é estritamente controlada pela lógica interna de cada ação. Cada fase determina quais ações são aceitas e quais movimentos são válidos.

---

#### `Coord`
```typescript
interface Coord { q: number; r: number; }
```
Par de coordenadas axiais hexagonais. O eixo `q` é horizontal e o eixo `r` é diagonal. Todo ponto do tabuleiro é identificado por um par `(q, r)`.

---

#### `Run`
```typescript
interface Run { coords: string[]; player: Player; }
```
Uma sequência de 5 marcadores consecutivos do mesmo jogador em uma linha reta. `coords` é um array de 5 strings no formato `"q,r"`. Quando um `Run` é detectado, o jogador deve escolhê-lo para remoção.

---

#### `YinshState`
```typescript
interface YinshState {
  board: Map<string, CellContent>;
  currentPlayer: Player;
  phase: GamePhase;
  ringsPlaced: { white: number; black: number };
  ringsRemoved: { white: number; black: number };
  selectedRing: string | null;
  detectedRuns: Run[];
  runRemovalPlayer: Player | null;
  winner: Player | null;
}
```
O estado completo e imutável do jogo em um dado momento:

| Campo | Descrição |
|---|---|
| `board` | Mapa de `"q,r"` → `CellContent` para todas as ~85 posições válidas |
| `currentPlayer` | Jogador da vez nas fases normais |
| `phase` | Fase atual do jogo |
| `ringsPlaced` | Contagem de anéis já colocados na fase inicial (máx 5 por jogador) |
| `ringsRemoved` | Contagem de anéis já removidos (pontuação; 3 = vitória) |
| `selectedRing` | Coordenada do anel selecionado na fase `move-ring` |
| `detectedRuns` | Array de todas as sequências de 5 detectadas no momento |
| `runRemovalPlayer` | Jogador que deve remover a sequência atual |
| `winner` | `null` enquanto o jogo está em andamento; `"white"` ou `"black"` quando termina |

---

### 1.2 Sistema de Coordenadas Hexagonais

O tabuleiro YINSH é hexagonal. O código usa o sistema de **coordenadas axiais** (também chamado de sistema `q, r`), padrão para grades hexagonais planas.

#### `coordKey(q, r): string`
Converte um par `(q, r)` em uma string chave `"q,r"` usada como índice no `Map` do tabuleiro. Exemplo: `coordKey(2, -3)` → `"2,-3"`.

#### `parseCoord(key): Coord`
Operação inversa. Converte `"2,-3"` → `{ q: 2, r: -3 }`.

#### `coordToPixel(q, r, spacing): { x, y }`
Converte coordenadas axiais em coordenadas de pixel SVG para renderização:
```
x = spacing * (q + r/2)
y = spacing * (√3/2) * r
```
A constante `spacing = 40` é usada em `useYinshGame.ts` como distância entre centros de células adjacentes em pixels. A fórmula produz um grid hexagonal de orientação "flat-top" (bordas horizontais).

#### As 6 Direções
```typescript
const DIRECTIONS: Coord[] = [
  { q: 1, r: 0 },   // leste
  { q: 0, r: 1 },   // sudeste
  { q: -1, r: 1 },  // sudoeste
  { q: -1, r: 0 },  // oeste
  { q: 0, r: -1 },  // noroeste
  { q: 1, r: -1 },  // nordeste
];
```
Usadas nos cálculos de movimentos de anel e de detecção de sequências. Os anéis se movem em linha reta ao longo dessas 6 direções.

---

### 1.3 Posições Válidas do Tabuleiro

```typescript
const BOARD_RADIUS = 5;
const REMOVED_CORNERS = new Set(["0,-5","5,-5","5,0","0,5","-5,5","-5,0"]);
```

`generateValidPositions()` gera todas as posições de um hexágono de raio 5 em coordenadas axiais (que forma um hexágono com 61 posições internas), **excluindo os 6 cantos extremos**. O resultado é um tabuleiro com **85 posições válidas**, armazenado na constante exportada `VALID_POSITIONS`.

O loop itera `r` de `-5` a `5`, e para cada `r` calcula os limites de `q` usando `q1 = max(-5, -r-5)` e `q2 = min(5, -r+5)`, o que gera o formato hexagonal. Os 6 vértices extremos são então removidos manualmente via `REMOVED_CORNERS`.

---

### 1.4 Classe YinshGame

A classe central do sistema. Encapsula o estado completo (`YinshState`) e fornece todos os métodos para avançar o jogo.

#### `constructor(state?: YinshState)`
- **Sem argumento**: cria um novo jogo com tabuleiro vazio, `currentPlayer = "white"`, fase `"placing-rings"` e todos os contadores zerados.
- **Com `state`**: restaura um estado previamente serializado. Usado por `clone()`, por `undo()` e pela restauração via árvore de estados.

#### `getState(): Readonly<YinshState>`
Retorna o estado interno com readonly, impedindo modificações externas diretas.

#### `clone(): YinshGame`
Cria uma **cópia profunda** do jogo. Clona o `Map` do tabuleiro (`new Map(this.state.board)`), os objetos `ringsPlaced` e `ringsRemoved` com spread (`{...}`), e o array `detectedRuns` com mapeamento element-a-element. Essencial para a geração de estados filhos na árvore de decisão sem contaminar o estado original.

---

### 1.5 Fases do Jogo — Fluxo Completo

#### Fase 1: `placing-rings`
**Condição de início**: estado inicial do jogo.

Nesta fase, os jogadores se alternam colocando anéis no tabuleiro vazio. Cada jogador coloca **5 anéis** cada, totalizando **10 anéis** para encerrar a fase.

**Transição automática**: quando `ringsPlaced.white + ringsPlaced.black >= 10`, a fase muda para `"place-marker"`. A troca de jogador ocorre a cada anel colocado (mesmo na última jogada que dispara a transição).

---

#### Fases 2+3: `place-marker` → `move-ring`

Estas duas fases formam o **turno padrão** do jogo. São executadas sempre em sequência dentro do mesmo turno do mesmo jogador:

**`place-marker`**: o jogador clica em um de seus próprios anéis. O anel é substituído por um marcador da sua cor. A posição do anel é salva em `selectedRing`.

**`move-ring`**: o jogador escolhe onde mover o anel (que agora está na mão). As posições válidas são calculadas por `getValidRingMoves()`. O anel é colocado na nova posição, todos os marcadores no caminho são invertidos, e `checkForRuns()` é chamado.

---

#### Fase 4: `remove-run`
**Condição de entrada**: `checkForRuns()` detecta uma ou mais sequências de 5 após um movimento de anel.

O jogador com sequência (`runRemovalPlayer`) clica em qualquer célula pertencente a uma de suas sequências para selecioná-la. Os 5 marcadores da sequência são removidos do tabuleiro. O jogo avança para `"remove-ring"`.

**Prioridade**: se o `currentPlayer` tem sequências, ele age primeiro. Caso contrário, o oponente age.

---

#### Fase 5: `remove-ring`
**Condição de entrada**: logo após `remove-run`.

O mesmo jogador (`runRemovalPlayer`) deve remover **um de seus próprios anéis** do tabuleiro. Isso representa o ponto marcado: o anel é removido permanentemente e `ringsRemoved[player]++`.

**Após a remoção**, o sistema verifica em cascata:
1. Se `ringsRemoved[player] >= 3` → vitória desse jogador → `"game-over"`.
2. Se ainda há sequências do mesmo jogador → volta para `"remove-run"` (múltiplas sequências simultâneas).
3. Se o oponente tem sequências pendentes → troca `runRemovalPlayer` → `"remove-run"`.
4. Senão → limpa `runRemovalPlayer`, troca `currentPlayer`, volta para `"place-marker"`.

---

#### Fase 6: `game-over`
Estado terminal. `getValidMoves()` retorna array vazio. Nenhuma ação é mais aceita. `winner` contém o vencedor.

---

### 1.6 Cálculo de Movimentos Válidos

`getValidMoves(): string[]` retorna o conjunto de coordenadas legais dependendo da fase atual:

| Fase | Retorna |
|---|---|
| `placing-rings` | Todas as células `null` do tabuleiro |
| `place-marker` | Coordenadas dos anéis do jogador atual que possuem ao menos um destino válido para mover |
| `move-ring` | Destinos válidos para o anel em `selectedRing` |
| `remove-run` | União de todas as coordenadas de todas as sequências do `runRemovalPlayer` |
| `remove-ring` | Coordenadas de todos os anéis do `runRemovalPlayer` |
| `game-over` | `[]` |

#### `getValidRingMoves(fromCoord): string[]` (privado)
Implementa as regras de movimento de anel do YINSH. O anel pode se mover em **linha reta** em qualquer das 6 direções, seguindo estas regras específicas:

1. O anel percorre a direção célula a célula.
2. Células **vazias** são destinos válidos. Se o anel ainda não passou por nenhum marcador (`jumpedOverMarkers = false`), pode continuar além delas. Se já passou por marcadores (`jumpedOverMarkers = true`), para imediatamente após a primeira célula vazia.
3. Células com **marcadores** (brancos ou pretos) são atravessadas. O flag `jumpedOverMarkers` é ativado. O anel não pode aterrissar em cima de um marcador.
4. Células com **anéis** (brancos ou pretos) bloqueiam o movimento — o loop para.
5. Células fora de `VALID_POSITIONS` encerram o loop nessa direção.

Esta lógica produz o comportamento característico do YINSH onde um anel "salta" sobre marcadores mas deve parar logo após.

---

### 1.7 Ações do Jogador

#### `placeRing(coord): boolean`
Pré-condições: fase `placing-rings`, coordenada em `VALID_POSITIONS`, célula vazia.

Passos internos:
1. Coloca `"W_RING"` ou `"B_RING"` na célula.
2. Incrementa `ringsPlaced[currentPlayer]`.
3. Se total de anéis atingir 10, muda fase para `"place-marker"`.
4. Troca `currentPlayer`.

---

#### `placeMarker(coord): boolean`
Pré-condições: fase `place-marker`, célula contém o anel do `currentPlayer`.

Passos internos:
1. Substitui o anel por um marcador (`"W_MARKER"` ou `"B_MARKER"`).
2. Armazena a coordenada em `selectedRing`.
3. Muda fase para `"move-ring"`.

---

#### `moveRing(dest): boolean`
Pré-condições: fase `move-ring`, `selectedRing` não nulo, `dest` em `getValidRingMoves(selectedRing)`.

Passos internos:
1. Chama `flipMarkersBetween(selectedRing, dest)` — inverte todos os marcadores no caminho.
2. Coloca o anel do `currentPlayer` em `dest`.
3. Limpa `selectedRing`.
4. Chama `checkForRuns()` que decide a próxima fase.

---

#### `selectRun(runIndex): boolean`
Pré-condições: fase `remove-run`, `runIndex` válido nas sequências do `runRemovalPlayer`.

Passos internos:
1. Remove os 5 marcadores da sequência escolhida do tabuleiro (setando cada célula como `null`).
2. Recalcula `detectedRuns` (a remoção pode ter desfeito outras sequências).
3. Muda fase para `"remove-ring"`.

---

#### `removeRing(coord): boolean`
Pré-condições: fase `remove-ring`, coordenada contém anel do `runRemovalPlayer`.

Passos internos (detalhados na seção 1.10):
1. Remove o anel do tabuleiro.
2. Incrementa `ringsRemoved[runRemovalPlayer]`.
3. Avalia condições de vitória, sequências restantes e oponente em cascata.

---

#### `getAvailableActions()`
Versão semântica de `getValidMoves()` para uso por IA. Em `"remove-run"` retorna objetos `{ type: "select-run", target, runIndex }` já com o índice da run. Nas demais fases, mapeia cada coordenada válida para `{ type: phase, target: coord }`.

---

### 1.8 Detecção de Sequências (Runs)

`detectRuns(): Run[]` (privado) varre o tabuleiro inteiro em busca de 5 ou mais marcadores consecutivos do mesmo jogador em linha reta.

**Eixos verificados** (apenas 3 dos 6 são necessários para cobrir todas as linhas sem duplicação):
```typescript
{ q: 1, r: 0 }   // horizontal
{ q: 0, r: 1 }   // diagonal /
{ q: 1, r: -1 }  // diagonal \
```

**Algoritmo por célula por eixo**:
1. Para cada marcador (`W_MARKER` ou `B_MARKER`) no tabuleiro:
2. Para cada um dos 3 eixos:
3. Recua na direção negativa até encontrar uma célula diferente — isso encontra o **início** da sequência.
4. Avança a partir do início contando quantas células consecutivas têm o mesmo conteúdo.
5. Se o comprimento for `>= 5`, cada janela de 5 dentro dessa sequência é registrada como um `Run` separado. Uma chave `runKey` (coordenadas unidas por `|`) evita duplicações usando um `Set<string>`.

Resultado: todas as sequências atualmente presentes no tabuleiro, com `player` indicando o dono.

---

### 1.9 Flip de Marcadores

`flipMarkersBetween(fromCoord, toCoord)` (privado) inverte os marcadores entre a posição original do anel e a nova posição, **sem incluir a posição destino**.

**Cálculo da direção**:
```
dq = sign(to.q - from.q)  // -1, 0 ou 1
dr = sign(to.r - from.r)  // -1, 0 ou 1
```

**Loop**: começa em `(from.q + dq, from.r + dr)` e avança até chegar em `toCoord`. Para cada célula no caminho:
- `"W_MARKER"` → `"B_MARKER"`
- `"B_MARKER"` → `"W_MARKER"`
- Células com anéis ou vazias não são afetadas (o anel não pode pousar no meio de anéis; vazias não têm nada para flipar)

Este é o mecanismo central do YINSH: ao mover um anel, o jogador inverte a cor de todos os marcadores no caminho, criando dinâmicas estratégicas complexas.

---

### 1.10 Verificação de Vitória e Empate

#### `checkForRuns()` (privado)
Chamado após cada `moveRing`. Usa `detectRuns()` e:
- Se há runs: define `runRemovalPlayer` (prioridade: currentPlayer se ele tem runs, senão o oponente), armazena em `detectedRuns`, muda para `"remove-run"`.
- Se não há runs: troca `currentPlayer`, muda para `"place-marker"`, chama `checkForDraw()`.

#### `removeRing()` — cascata de decisão
Após remover o anel, a lógica em cascata é:
```
ringsRemoved[player] >= 3  →  winner = player, phase = "game-over"  (FIM)
                            ↓
detectedRuns para player > 0  →  phase = "remove-run"               (mais runs do mesmo)
                            ↓
detectedRuns para oponente > 0  →  runRemovalPlayer = oponente, phase = "remove-run"
                            ↓
senão  →  runRemovalPlayer = null, troca currentPlayer, phase = "place-marker"
```

#### `checkForDraw()` (privado)
Só é relevante na fase `"place-marker"`. Se `getValidMoves()` retorna array vazio (nenhum anel do `currentPlayer` tem destinos possíveis), o jogo termina com `phase = "game-over"` sem `winner` (empate).

---

## 2. GameStateTree.ts

Este arquivo implementa a **árvore de estados** do jogo. Armazena todos os estados já visitados (jogados ou explorados), permite navegar pela história da partida, gera antecipadamente os estados filhos (um nível de lookahead), e suporta exportação/importação em XML.

---

### 2.1 Serialização de Estado

`serializeState(state): string` produz uma **string canônica determinística** de um `YinshState`.

**Composição da string** (campos unidos por `|`):
1. **Board**: apenas células não-nulas, ordenadas lexicograficamente por coordenada, no formato `"q,r:CONTEÚDO"` separadas por `,`.
2. `currentPlayer`
3. `phase`
4. `ringsPlaced.white`
5. `ringsPlaced.black`
6. `ringsRemoved.white`
7. `ringsRemoved.black`
8. `selectedRing` (ou `""` se null)
9. `runRemovalPlayer` (ou `""` se null)
10. `winner` (ou `""` se null)

A ordenação lexicográfica do board garante que dois estados com o mesmo tabuleiro mas iterados em ordens diferentes do `Map` produzam a mesma string. Isso é essencial para a deduplicação de estados.

**Exemplo de saída**:
```
-1,0:W_RING,0,1:B_RING|white|place-marker|5|5|0|0|||
```

---

### 2.2 Hash de Estado (djb2)

`hashState(state): string` calcula um hash de 32 bits (unsigned) da string serializada usando o algoritmo **djb2**:

```typescript
let hash = 5381;
for (let i = 0; i < s.length; i++) {
  hash = ((hash << 5) + hash) ^ s.charCodeAt(i);  // hash * 33 XOR char
  hash = hash >>> 0;  // força unsigned 32-bit
}
return hash.toString(16);  // string hexadecimal
```

O resultado é um hash hexadecimal de até 8 caracteres usado como **ID único do nó** na árvore. A probabilidade de colisão é baixa o suficiente para o tamanho da árvore de uma partida YINSH, mas a deduplicação usa a string completa (`serializeState`) como chave no `Set<string> seenStates` para garantia absoluta.

---

### 2.3 Estrutura do Nó da Árvore

#### `TreeNodeData`
```typescript
interface TreeNodeData {
  id: string;          // hash único do estado
  depth: number;       // profundidade na árvore (0 = raiz)
  move: string | null; // descrição legível da jogada que levou a este nó
  stateSnapshot: SerializedState;  // estado completo serializado
  childIds: string[];  // IDs dos filhos diretos
  isPlayed: boolean;   // true se este nó foi realmente jogado
  parentId: string | null;  // ID do nó pai
}
```

O campo `move` tem formatos diferentes por fase:
- `placing-rings` / `remove-ring`: `"q,r"` — coordenada da ação
- `place-marker` + `move-ring` (combinado): `"q1,r1→q2,r2"` — anel selecionado → destino
- `remove-run` + `remove-ring` (combinado): `"run[c1,c2…]→remove(q,r)"`

#### `SerializedState`
Versão JSON-friendly de `YinshState`: o `Map<string, CellContent>` é convertido para `[string, CellContent][]` (array de pares), permitindo serialização em JSON e XML. `detectedRuns` é omitido pois é transitório e recalculado pelo jogo ao ser restaurado.

---

### 2.4 Geração de Estados Filhos

`generateChildGames(parentGame): { move, game }[]` gera todos os estados-filho possíveis a partir de um estado pai. É usada exclusivamente por `_expandChildren`.

#### Caso `place-marker` (fase de 2 cliques)
Para cada anel do `currentPlayer` no tabuleiro:
1. Clona o jogo, chama `placeMarker(key)`.
2. Para cada destino válido do `getValidMoves()` (que agora é `move-ring`):
3. Clona novamente, chama `moveRing(dest)`.
4. Registra `move = "key→dest"`.

Resultado: cada combinação (anel escolhido × destino de movimento) gera um filho distinto.

#### Caso `remove-run` (fase de 2 cliques)
Para cada run do `runRemovalPlayer`:
1. Clona, `selectRun(i)`.
2. Para cada anel removível (`getValidMoves()` agora é `remove-ring`):
3. Clona, `removeRing(dest)`.
4. Registra `move = "run[c1,c2…]→remove(dest)"`.

#### Demais fases (`placing-rings`, `remove-ring`)
São fases de clique único. Para cada coordenada em `getValidMoves()`:
1. Clona, executa `placeRing(coord)` ou `removeRing(coord)`.
2. Registra `move = coord`.

Nota: `move-ring` nunca aparece aqui pois é sempre gerado em conjunto com `place-marker`.

---

### 2.5 Classe GameStateTree

```typescript
class GameStateTree {
  nodes: Map<string, TreeNodeData>;  // todos os nós: id → dados
  private seenStates: Set<string>;   // strings canônicas já vistas (deduplicação)
  rootId: string | null;             // ID do nó raiz
  currentId: string | null;          // ID do nó atual (estado real do jogo)
  playedPath: string[];              // sequência de IDs da raiz até o estado atual
}
```

`nodes` é público para acesso pelo renderizador (`GameTreeView.tsx`). `seenStates` é privado e serve como cache de deduplicação: um estado que já está em `seenStates` não é reinserido como filho, evitando ciclos e explosão exponencial.

---

### 2.6 Inicialização da Árvore

`init(game: YinshGame)` é chamado uma vez ao criar uma nova partida.

Passos:
1. Limpa `nodes`, `seenStates`, `playedPath`.
2. Calcula o hash do estado inicial → cria o nó raiz com `depth=0`, `isPlayed=true`, `parentId=null`.
3. Registra `rootId = currentId = id`, `playedPath = [id]`.
4. Chama `_expandChildren(id, game)` para pré-calcular todos os filhos do estado inicial.

---

### 2.7 Registro de Jogada (applyMove)

`applyMove(newGame: YinshGame)` é chamado cada vez que o jogador faz uma jogada real no tabuleiro.

Passos detalhados:
1. Serializa e hasha o novo estado.
2. Busca o nó em `nodes`:
   - **Se não existe** (jogada para um estado nunca visto): cria nó com `depth = playedPath.length`, adiciona como filho do `currentId` se ainda não estava em `childIds`.
   - **Se já existe** (o estado estava nos filhos pré-gerados): marca `isPlayed = true`.
3. Atualiza `currentId` e appenda ao `playedPath`.
4. Chama `_expandChildren` para pré-calcular os filhos do novo estado atual.

---

### 2.8 Desfazer Jogada (undo)

`undo(): YinshGame | null`

Se `playedPath` tem comprimento `<= 1` (já está na raiz), retorna `null`.

Caso contrário:
1. Remove o último ID de `playedPath` via `pop()`.
2. Atualiza `currentId` para o novo último elemento.
3. Recupera o snapshot do nó, reconstrói `YinshGame`, retorna.

Nota: `undo()` **não** desmarca `isPlayed` nos nós visitados e **não** remove os nós criados. A árvore acumula todos os estados explorados.

---

### 2.9 Navegação para Nó Específico (navigateTo)

`navigateTo(nodeId): YinshGame | null` permite ir diretamente para qualquer nó clicável da árvore.

**Caso 1 — Retroceder (nó no playedPath)**:
Se `nodeId` está em `playedPath`:
1. Trunca `playedPath` até incluir `nodeId` (todos os estados à frente são "desfeitos").
2. Atualiza `currentId`.
3. Reconstrói e retorna o `YinshGame`.

Isso implementa o "desfazer múltiplo" em um único clique.

**Caso 2 — Avançar (filho direto do nó atual)**:
Se `nodeId` está em `childIds` do `currentId`:
1. Marca `isPlayed = true` no nó destino.
2. Appenda ao `playedPath`.
3. Expande filhos se ainda não tiverem sido gerados.
4. Retorna o `YinshGame` restaurado.

**Caso inválido**: nó não encontrado ou nó de nível não-adjacente → retorna `null`.

---

### 2.10 IDs Navegáveis (getNavigableIds)

`getNavigableIds(): Set<string>` retorna o conjunto de todos os IDs que são **clicáveis** na interface:

```
navigableIds = (todos os IDs em playedPath EXCETO currentId) 
               ∪ (todos os childIds do nó currentId)
```

- Os ancestrais no `playedPath` permitem navegar para trás.
- Os filhos diretos permitem navegar para frente (escolher um ramo específico).
- Nós de outros ramos não são navegáveis diretamente.

---

### 2.11 Expansão de Filhos (_expandChildren)

`_expandChildren(parentId, parentGame)` (privado) é o mecanismo de **lookahead** da árvore.

Passos:
1. Obtém o nó pai.
2. Chama `generateChildGames(parentGame)` para gerar todos os estados-filho possíveis.
3. Para cada filho gerado:
   a. Serializa e hasha.
   b. **Se o estado já foi visto** (`seenStates.has(childSig)`): ignora — previne loops.
   c. Caso contrário: adiciona a `seenStates`, cria o `TreeNodeData` com `isPlayed = false`, insere em `nodes`, adiciona o ID a `parent.childIds`.

O lookahead é de **apenas 1 nível** a partir do estado atual. Ele não expande recursivamente a árvore inteira, o que manteria memória controlada. A expansão acontece progressivamente conforme a partida avança.

---

### 2.12 Serialização XML (toXML / fromXML)

#### `toXML(): string`
Gera um documento XML completo da árvore inteira.

**Estrutura XML**:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<yinshTree>
  <meta>
    <rootId>abc123</rootId>
    <currentId>def456</currentId>
    <playedPath>abc123,bcd234,def456</playedPath>
  </meta>
  <nodes>
    <node id="abc123">
      <depth>0</depth>
      <move></move>
      <isPlayed>true</isPlayed>
      <parentId></parentId>
      <childIds>bcd234,cde345,eff678</childIds>
      <snapshot>
        <currentPlayer>white</currentPlayer>
        <phase>place-marker</phase>
        <ringsPlaced white="5" black="5"/>
        <ringsRemoved white="0" black="0"/>
        <selectedRing></selectedRing>
        <runRemovalPlayer></runRemovalPlayer>
        <winner></winner>
        <board>
          <cell key="-1,0" val="W_RING"/>
          <cell key="0,1" val="B_RING"/>
          <!-- ... apenas células não-nulas -->
        </board>
      </snapshot>
    </node>
    <!-- ... demais nós -->
  </nodes>
</yinshTree>
```

Todos os valores passam pela função `esc()` que escapa `&`, `<`, `>`, `"` para XML válido. Células `null` do board não são escritas (economia de espaço).

#### `fromXML(xml): GameStateTree` (estático)
Parser completo do XML:
1. Usa `DOMParser` nativo do browser.
2. Lê `<meta>` para restaurar `rootId`, `currentId` e `playedPath`.
3. Itera sobre `<nodes > node>`: para cada nó, reconstrói `TreeNodeData` completo incluindo o `stateSnapshot` com o board.
4. Após reconstruir todos os nós, repopula `seenStates` serializando cada snapshot — necessário para que `_expandChildren` funcione corretamente após o carregamento.

---

### 2.13 Persistência em Arquivo

#### `saveToFile(filename)`
1. Chama `toXML()`.
2. Cria um `Blob` com MIME `application/xml`.
3. Cria uma URL temporária com `URL.createObjectURL`.
4. Cria um `<a>` invisível com `download` attribute e simula clique.
5. Revoga a URL.

#### `loadFromFile(file): Promise<GameStateTree>` (estático assíncrono)
1. Usa `FileReader` para ler o arquivo como texto.
2. Em `onload`, chama `fromXML()` e resolve a Promise.
3. Em `onerror`, rejeita.

---

### 2.14 Propriedades Computadas

#### `getCurrentGame(): YinshGame | null`
Reconstrói e retorna o `YinshGame` do `currentId`. Retorna `null` se não houver nó atual.

#### `get totalNodes(): number`
Tamanho do `Map nodes` — total de estados únicos na árvore.

#### `get maxDepth(): number`
Itera todos os nós e retorna o maior `depth`. Indica quantas jogadas a cadeia mais longa da árvore possui.

---

## 3. useGameTree.ts (Hook)

Hook React que serve como **interface entre a árvore de estados (`GameStateTree`) e os componentes React**. Gerencia re-renders sem clonar a árvore inteira a cada mutação.

---

### 3.1 Estado Interno e Estratégia de Re-render

```typescript
const [holder, setHolder] = useState<{ tree: GameStateTree; v: number }>(() => {
  const t = new GameStateTree();
  t.init(initialGame);
  return { tree: t, v: 0 };
});
```

O estado é um objeto wrapper `{ tree, v }`:
- `tree`: a instância de `GameStateTree`, que é **mutada in-place**.
- `v` (version): contador inteiro incrementado a cada mutação.

**Por que este design?** Clonar a `GameStateTree` a cada jogada seria caro (pode ter centenas de nós). Em vez disso, a árvore é mutada diretamente e `v` é incrementado para sinalizar ao React que algo mudou.

A função `bump()`:
```typescript
const bump = () => setHolder((h) => ({ tree: h.tree, v: h.v + 1 }));
```
Cria um novo objeto `holder` (nova referência, dispara re-render) sem modificar `tree`.

O `treeVersion` (exportado como `v`) é passado como prop para `GameTreeView`, onde é usado como dependência de `useMemo` para invalidar cálculos de layout mesmo quando a referência de `tree` não muda.

---

### 3.2 recordMove

```typescript
const recordMove = useCallback((newGame: YinshGame) => {
  tree.applyMove(newGame);
  bump();
}, [tree, bump]);
```

Registra uma jogada real na árvore. Chamado por `YinshBoard.tsx` após cada mudança de estado do jogo (via `useEffect` que observa `state`).

---

### 3.3 resetTree

```typescript
const resetTree = useCallback((newGame: YinshGame) => {
  const t = new GameStateTree();
  t.init(newGame);
  setHolder({ tree: t, v: 0 });
}, []);
```

Cria uma árvore completamente nova. Ao contrário de `bump`, usa `setHolder` diretamente para substituir a instância da árvore.

---

### 3.4 undoMove

```typescript
const undoMove = useCallback((): YinshGame | null => {
  const restored = tree.undo();
  if (restored) bump();
  return restored;
}, [tree, bump]);
```

Delega para `tree.undo()` e faz bump se bem-sucedido. Retorna o `YinshGame` restaurado para que o chamador possa aplicar o estado ao tabuleiro.

---

### 3.5 saveTree / loadTree

```typescript
const saveTree = () => tree.saveToFile(`yinsh_tree_${Date.now()}.xml`);
```
Gera nome de arquivo com timestamp Unix.

```typescript
const loadTree = async (file: File): Promise<YinshGame | null> => {
  const loaded = await GameStateTree.loadFromFile(file);
  setHolder({ tree: loaded, v: 0 });
  return loaded.getCurrentGame();
};
```
Substitui a árvore inteira e retorna o jogo do nó atual para que o tabuleiro seja restaurado.

---

### 3.6 navigateToNode

```typescript
const navigateToNode = useCallback((nodeId: string): YinshGame | null => {
  const restored = tree.navigateTo(nodeId);
  if (restored) bump();
  return restored;
}, [tree, bump]);
```

Permite navegar para qualquer nó navegável da árvore via clique na interface. O `YinshGame` retornado é aplicado ao tabuleiro por `YinshBoard.tsx`.

---

## 4. useYinshGame.ts (Hook)

Hook React que gerencia o **estado visual e interativo do tabuleiro YINSH**. Não conhece a árvore de estados; apenas mantém o `YinshGame` atual e expõe callbacks para a interface.

---

### 4.1 Estado Central

```typescript
const [game, setGame] = useState(() => new YinshGame());
const state = game.getState();
```

`game` é a instância atual de `YinshGame`. `state` é derivado via `getState()` — uma referência `Readonly` ao estado interno. Como `state` é derivado diretamente de `game` (sem useMemo), ele muda a cada re-render que troca `game`.

---

### 4.2 performAction

```typescript
const performAction = useCallback((action: (g: YinshGame) => boolean) => {
  setGame((prev) => {
    const clone = prev.clone();
    return action(clone) ? clone : prev;
  });
}, []);
```

Utilitário genérico para aplicar qualquer mutação ao jogo de forma imutável:
1. Clona o jogo atual.
2. Executa a `action` no clone.
3. Se `action` retornar `true` (sucesso), substitui o jogo pelo clone.
4. Se retornar `false` (ação inválida), mantém o estado anterior.

Este é o mecanismo usado por `YinshBoard.tsx` para aplicar jogos restaurados (undo, load, navegação na árvore) sem registrá-los novamente na árvore (`suppressNextRecordRef`).

---

### 4.3 Nós do Tabuleiro (BoardNode)

```typescript
const nodes: BoardNode[] = useMemo(() => {
  return Array.from(VALID_POSITIONS).map((key) => {
    const { q, r } = parseCoord(key);
    const { x, y } = coordToPixel(q, r, SPACING);
    return { key, q, r, x, y };
  });
}, []);
```

Calculado **uma única vez** (dependências vazias). Mapeia cada uma das ~85 posições válidas para um objeto com coordenadas axiais (`q, r`) e coordenadas de pixel (`x, y`). `SPACING = 40` pixels.

Estes nós são usados pelo SVG do tabuleiro para posicionar círculos, anéis e marcadores.

---

### 4.4 Arestas do Tabuleiro (BoardEdge)

```typescript
const edges: BoardEdge[] = useMemo(() => { ... }, [nodes]);
```

Também calculado uma vez. Para cada nó, verifica os 3 vizinhos nas direções `(+1,0)`, `(0,+1)` e `(-1,+1)` (apenas 3 das 6 direções para evitar duplicar cada aresta). Se o vizinho existe em `VALID_POSITIONS`, cria uma aresta com as coordenadas de pixel dos dois extremos.

As arestas são renderizadas como linhas `<line>` no SVG para mostrar as conexões do tabuleiro hexagonal.

---

### 4.5 Movimentos Válidos

```typescript
const validMoves = useMemo(() => new Set(game.getValidMoves()), [game]);
```

Recalculado sempre que `game` muda. Converte o array de `getValidMoves()` em um `Set` para buscas O(1). Usado pelo SVG para renderizar círculos de "movimento válido" em verde sobre as posições disponíveis.

---

### 4.6 handleCellClick

```typescript
const handleCellClick = useCallback((coordStr: string) => {
  setGame((prev) => {
    const s = prev.getState();
    const clone = prev.clone();
    let success = false;
    switch (s.phase) {
      case "placing-rings": success = clone.placeRing(coordStr); break;
      case "place-marker":  success = clone.placeMarker(coordStr); break;
      case "move-ring":     success = clone.moveRing(coordStr); break;
      case "remove-run":    /* encontra runIndex e faz selectRun */ break;
      case "remove-ring":   success = clone.removeRing(coordStr); break;
    }
    return success ? clone : prev;
  });
}, []);
```

Callback principal de interação do usuário. Dentro do `setGame` updater (que recebe o estado mais recente):
1. Clona o jogo para imutabilidade.
2. Despacha para o método correto baseado na `phase` atual.
3. Para `remove-run`: encontra o índice da run que contém `coordStr` nos `detectedRuns` filtrados pelo `runRemovalPlayer`, e chama `selectRun(runIndex)`.
4. Retorna o clone se a ação teve sucesso, ou o estado anterior se inválida.

---

### 4.7 resetGame

```typescript
const resetGame = useCallback(() => {
  setGame(new YinshGame());
}, []);
```

Substituição simples por uma nova instância de `YinshGame`. `YinshBoard.tsx` chama `resetTree` em conjunto para sincronizar a árvore.

---

### 4.8 runCoords

```typescript
const runCoords = useMemo(() => {
  const coords = new Set<string>();
  if (state.phase === "remove-run" && state.runRemovalPlayer) {
    for (const run of state.detectedRuns) {
      if (run.player === state.runRemovalPlayer) {
        for (const c of run.coords) coords.add(c);
      }
    }
  }
  return coords;
}, [state.phase, state.detectedRuns, state.runRemovalPlayer]);
```

Conjunto de todas as coordenadas das sequências detectadas do `runRemovalPlayer`. Ativo apenas na fase `"remove-run"`. Usado pelo SVG para destacar em amarelo/laranja as células que fazem parte de sequências removíveis.

---

## 5. Fluxo de Dados Entre os Módulos

```
useYinshGame
    │
    │  game (YinshGame)
    │  state (YinshState)
    │  handleCellClick()
    │  validMoves, runCoords, nodes, edges
    │
    ▼
YinshBoard.tsx ──────────────────────────────────────────┐
    │                                                     │
    │ useEffect(state) → recordMove(YinshGame)            │
    │ handleUndo()     → undoMove() → applyRestoredGame() │
    │ handleNodeClick()→ navigateToNode() → applyRestoredGame()
    │                                                     │
    ▼                                                     │
useGameTree ←────────────────────────────────────────────┘
    │
    │  tree (GameStateTree)
    │  treeVersion
    │  recordMove / undoMove / navigateToNode / saveTree / loadTree
    │
    ▼
GameStateTree ←── GameMechanics (YinshGame, YinshState)
    │
    │  nodes (Map<id, TreeNodeData>)
    │  playedPath, currentId, rootId
    │  navigateTo() / undo() / applyMove()
    │
    ▼
GameTreeView.tsx
    (renderização SVG da árvore)
```

### Sincronização entre tabuleiro e árvore

`YinshBoard.tsx` usa dois mecanismos para manter tabuleiro e árvore sincronizados:

**Registrar jogada** (`useEffect` em `state`):
```
state muda → useEffect detecta → reconstrói YinshGame → recordMove(game)
```
Se `suppressNextRecordRef.current === true`, o registro é suprimido e o flag é limpo. Isso evita duplo-registro quando o estado é restaurado externamente.

**Aplicar estado restaurado** (`applyRestoredGame`):
```
undo/load/navigate → YinshGame restaurado → suppressNextRecordRef = true
                  → performAction() substitui state interno do hook
                  → useEffect detecta mudança → suprime registro → limpa flag
```

---

## 6. Diagrama de Fases do Jogo

```
                     INÍCIO
                       │
                       ▼
              ┌─────────────────┐
              │  placing-rings  │◄─── placeRing() x10
              └────────┬────────┘     (5 por jogador)
                       │ total ≥ 10
                       ▼
              ┌─────────────────┐
         ┌───►│  place-marker   │◄─── próximo turno
         │    └────────┬────────┘
         │             │ placeMarker()
         │             ▼
         │    ┌─────────────────┐
         │    │   move-ring     │
         │    └────────┬────────┘
         │             │ moveRing()
         │             │
         │    ┌─────────────────────────────┐
         │    │      checkForRuns()          │
         │    └──────┬──────────────────────┘
         │           │
         │     runs? ├── NÃO ──► troca currentPlayer ──┐
         │           │                                  │
         │           SIM                     checkForDraw()
         │           │                                  │
         │           ▼                   sem movimentos?│
         │    ┌─────────────────┐              │        │
         │    │   remove-run    │◄──── mais runs do     │
         │    └────────┬────────┘      mesmo jogador    │
         │             │ selectRun()                    │
         │             ▼                                │
         │    ┌─────────────────┐                       │
         │    │   remove-ring   │                       │
         │    └────────┬────────┘                       │
         │             │ removeRing()                   │
         │             │                                │
         │    ┌────────┴──────────────────────┐         │
         │    │ ringsRemoved ≥ 3?             │         │
         │    └─────┬─────────────────────────┘         │
         │      SIM │          NÃO                      │
         │          ▼           │                       │
         │   ┌────────────┐     │ mais runs?            │
         │   │ game-over  │     ├── SIM ─► remove-run   │
         │   └────────────┘     │                       │
         │                      └── NÃO ────────────────┘
         └──────────────────────── place-marker (próx turno)
```

---

*Documentação gerada com base no código-fonte de `GameMechanics.ts`, `GameStateTree.ts`, `useGameTree.ts` e `useYinshGame.ts`.*
