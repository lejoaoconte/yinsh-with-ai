# Árvore de Estados — yinsh-with-ai

**Apresentação para o Professor**

---

## O que é a Árvore de Estados?

Durante uma partida de YINSH, cada jogada transforma o tabuleiro em um novo estado completamente diferente do anterior. A **árvore de estados** é uma estrutura de dados que registra e organiza todos esses estados — tanto os que já foram jogados quanto os que *poderiam* ser jogados a partir do momento atual.

A ideia central é simples: cada **nó** da árvore representa um estado completo do tabuleiro em um determinado momento. Cada **aresta** entre dois nós representa a jogada que transformou um estado no outro. O conjunto de todos esses nós e arestas forma uma árvore que descreve visualmente o histórico e as possibilidades da partida.

```
         [Estado Inicial]
               │
        ┌──────┴──────┐
   [Jogada A]    [Jogada B]     ← possibilidades previstas
        │
   [Jogada A1]
        │
   [Estado Atual ★]
   ┌────┴────┐
[Opção 1] [Opção 2]             ← próximas jogadas já calculadas
```

---

## 1. Como os Estados são Representados

### O Estado Completo do Jogo

Antes de explicar a árvore, é importante entender o que constitui um "estado" do jogo. Um estado captura **tudo** que é necessário para descrever o jogo em um determinado momento:

| Campo | O que representa |
|---|---|
| `board` | Conteúdo de cada uma das 85 posições do tabuleiro |
| `currentPlayer` | De quem é a vez (`"white"` ou `"black"`) |
| `phase` | Em qual fase do jogo estamos (colocar anel, mover anel, etc.) |
| `ringsPlaced` | Quantos anéis cada jogador já colocou na fase inicial |
| `ringsRemoved` | Quantos anéis cada jogador já removeu (a pontuação) |
| `selectedRing` | Qual anel está selecionado no momento (se houver) |
| `runRemovalPlayer` | Qual jogador deve remover uma sequência (se houver) |
| `winner` | O vencedor (ou `null` se o jogo ainda está em andamento) |

Esse objeto é chamado de `YinshState` no código e é armazenado dentro de cada nó da árvore como um **snapshot** — uma fotografia completa do jogo naquele instante.

---

## 2. Como um Estado é Identificado Unicamente

Para organizar a árvore, é necessário identificar cada estado de forma única. O sistema usa dois mecanismos encadeados:

### 2.1 Serialização Canônica

O primeiro passo é converter o estado em uma **string de texto determinística** — ou seja, dois estados idênticos sempre produzem exatamente a mesma string, independentemente da ordem em que as peças foram colocadas no `Map` interno.

A função `serializeState()` faz isso em etapas:

**Passo 1 — Serializar o tabuleiro:**
Filtra apenas as células não-vazias, ordena as coordenadas em ordem lexicográfica, e une no formato `"q,r:CONTEÚDO"`:
```
-2,1:W_RING,-1,0:B_MARKER,0,2:W_RING,...
```

A ordenação é fundamental: se o `Map` do JavaScript iterar as chaves em ordens diferentes em execuções distintas, a string seria diferente para o mesmo estado. A ordenação garante consistência.

**Passo 2 — Concatenar os demais campos:**
Os campos são unidos com `|` como separador:
```
-2,1:W_RING,-1,0:B_MARKER|white|place-marker|5|5|0|0|||
```
Campos nulos (como `selectedRing` quando nenhum anel está selecionado) são substituídos por string vazia `""`.

### 2.2 Hash djb2

A string canônica pode ser longa (dezenas de caracteres para cada peça no tabuleiro). Para usar como chave em um `Map`, o sistema aplica o algoritmo de hash **djb2**, que transforma a string em um número de 32 bits:

```typescript
let hash = 5381;
for (let i = 0; i < s.length; i++) {
  hash = ((hash << 5) + hash) ^ s.charCodeAt(i);
  hash = hash >>> 0;  // garante 32 bits sem sinal
}
return hash.toString(16);  // ex: "3f8a2c1d"
```

O resultado é um **ID hexadecimal** de até 8 caracteres que identifica o nó na árvore. Por exemplo: `"3f8a2c1d"`.

> **Importante:** a deduplicação de estados nunca usa apenas o hash — usa a string completa serializada armazenada em um `Set`. O hash serve como chave de busca rápida; a string completa garante que dois estados diferentes que gerassem o mesmo hash (colisão) não seriam confundidos.

---

## 3. A Estrutura de Cada Nó

Cada nó da árvore é um objeto `TreeNodeData` com os seguintes campos:

```typescript
interface TreeNodeData {
  id: string;                  // hash hexadecimal do estado
  depth: number;               // profundidade na árvore (0 = raiz)
  move: string | null;         // descrição da jogada que chegou aqui
  stateSnapshot: SerializedState; // fotografia completa do estado
  childIds: string[];          // IDs dos nós filhos
  isPlayed: boolean;           // foi realmente jogado ou apenas previsto?
  parentId: string | null;     // ID do nó pai
}
```

### O campo `isPlayed`

Este campo é a distinção mais importante da árvore:

- `isPlayed = true` → o jogador **realmente** chegou neste estado durante a partida
- `isPlayed = false` → o estado foi **previsto automaticamente** pelo sistema como possibilidade futura

Visualmente na interface, nós jogados aparecem em **verde**, o estado atual em **azul** com uma estrela ★, e nós previstos em cinza.

### O campo `move`

Armazena uma descrição legível da jogada que levou a este nó. O formato varia por tipo de jogada:

| Tipo de jogada | Formato do `move` | Exemplo |
|---|---|---|
| Colocar anel | Coordenada | `"2,-1"` |
| Marcador + mover anel | Origem → Destino | `"-1,0→2,1"` |
| Remover sequência + anel | Sequência → Anel removido | `"run[-1,0,-1,1…]→remove(0,2)"` |

### O campo `stateSnapshot`

É a versão "JSON-friendly" do `YinshState`, onde o `Map<string, CellContent>` do tabuleiro é convertido para um array de pares `[string, CellContent][]`, pois `Map` não é diretamente serializável em JSON ou XML:

```typescript
interface SerializedState {
  board: [string, CellContent][];   // ex: [["-1,0","W_RING"],["0,1","B_MARKER"],...]
  currentPlayer: string;
  phase: string;
  ringsPlaced: { white: number; black: number };
  ringsRemoved: { white: number; black: number };
  selectedRing: string | null;
  runRemovalPlayer: string | null;
  winner: string | null;
}
```

Nota: `detectedRuns` não é salvo no snapshot. Como as sequências detectadas são calculadas a partir do tabuleiro, elas são recalculadas pelo motor do jogo quando o estado é restaurado — não faz sentido persistir um dado transitório que pode ser recomputado.

---

## 4. Como as Próximas Jogadas são Previstas

Este é o núcleo intelectual do sistema. A função `generateChildGames()` recebe um estado atual e **executa automaticamente todas as jogadas possíveis**, retornando um novo `YinshGame` para cada resultado.

### 4.1 O Princípio: Clonar e Executar

O motor de jogo (`YinshGame`) é uma máquina de estados com um método `clone()` que cria uma cópia profunda independente. `generateChildGames()` explora todas as possibilidades clonando o jogo e executando cada ação possível:

```
Estado Pai (clonado N vezes)
    ↓
Clone 1 → ação A → Estado filho A
Clone 2 → ação B → Estado filho B
Clone 3 → ação C → Estado filho C
...
```

O estado original nunca é modificado. Apenas os clones são mutados.

### 4.2 Geração por Fase

#### Fase `placing-rings` (colocar anel)
A lógica é simples: cada célula vazia é uma jogada possível. Para cada coordenada válida, clona o jogo e chama `placeRing(coord)`.

#### Fase `place-marker` + `move-ring` (turno normal)
Este é o caso mais complexo. Um turno completo envolve **dois cliques** do jogador: escolher um anel e depois escolher o destino do movimento. O sistema gera **todas as combinações possíveis**:

```
Para cada anel do jogador:
  Clone → placeMarker(anel) → estado intermediário
  Para cada destino válido desse anel:
    Clone do intermediário → moveRing(destino) → estado final filho
    Registra move = "anel→destino"
```

Se um jogador tem 5 anéis e cada anel tem em média 10 destinos possíveis, isso gera até **50 filhos** a partir de um único estado.

#### Fase `remove-run` + `remove-ring` (remoção de sequência)
Similar ao turno normal: envolve escolher qual sequência remover e qual anel retirar. O sistema combina todas as opções:

```
Para cada sequência do jogador:
  Clone → selectRun(i) → estado intermediário
  Para cada anel que pode ser removido:
    Clone → removeRing(anel) → estado final filho
```

#### Fase `remove-ring` isolada
Não ocorre diretamente em `generateChildGames` como fase única — é sempre combinada com `remove-run` acima.

### 4.3 Verificação de Validade Durante a Geração

O sistema **não** verifica validade com lógica separada. Em vez disso, ele simplesmente **tenta executar** cada ação usando o motor do jogo, e a ação retorna `true` ou `false`:

```typescript
const g1 = parentGame.clone();
if (!g1.placeMarker(key)) continue;  // inválido → pula
```

Se a ação falhar (retornar `false`), o clone é descartado e o sistema passa para a próxima possibilidade. Toda a validação das regras do YINSH está encapsulada nos métodos do motor (`placeRing`, `moveRing`, etc.) — a geração de filhos apenas aproveita essa validação existente.

Isso garante que **todos os estados filhos gerados são garantidamente estados legais** do jogo. Nunca há um nó na árvore que represente um estado de jogo inválido.

---

## 5. Como a Árvore Cresce: Expansão Progressiva

A árvore não é expandida de uma vez só no início da partida — isso seria computacionalmente inviável (o número de estados de YINSH é astronomicamente grande). Em vez disso, ela cresce **progressivamente**, sempre apenas 1 nível à frente do estado atual.

### O método `_expandChildren()`

Toda vez que o estado atual muda (seja por uma jogada real ou por navegação), o sistema chama `_expandChildren(parentId, parentGame)`:

```
Estado Atual (nó pai)
    → generateChildGames() → [filho1, filho2, ..., filhoN]
    → Para cada filho:
        → Serializa e hasha
        → Verifica se já foi visto (seenStates)
        → Se novo: cria nó com isPlayed=false, adiciona ao pai
        → Se já existe: ignora
```

### O mecanismo anti-duplicação

O conjunto `seenStates: Set<string>` armazena as **strings serializadas completas** de todos os estados já vistos. Antes de criar qualquer nó filho, o sistema verifica:

```typescript
if (this.seenStates.has(childSig)) continue;
```

Isso tem dois propósitos:
1. **Evitar duplicatas**: se dois caminhos diferentes levam ao mesmo estado do tabuleiro, o estado aparece na árvore apenas uma vez.
2. **Evitar loops**: em tese, sequências de jogadas poderiam levar de volta a um estado anterior. O `seenStates` impede que isso crie um ciclo infinito.

---

## 6. O Caminho Jogado: Rastreando o Histórico

A árvore mantém três elementos para rastrear a posição atual na história da partida:

| Campo | Tipo | Função |
|---|---|---|
| `rootId` | `string` | ID do estado inicial da partida |
| `currentId` | `string` | ID do estado atual (onde o jogo está agora) |
| `playedPath` | `string[]` | Sequência de IDs da raiz até o estado atual |

O `playedPath` é um array de IDs em ordem cronológica. Por exemplo, após 4 jogadas:

```
playedPath = ["abc1", "def2", "ghi3", "jkl4", "mno5"]
              raiz    jog.1   jog.2   jog.3   atual
```

Esse array é fundamental para todas as operações de navegação temporal: desfazer, navegar para um estado anterior e identificar quais nós pertencem ao caminho jogado.

---

## 7. Como uma Jogada Real é Registrada

Quando o jogador faz uma jogada no tabuleiro, o método `applyMove(newGame)` é chamado:

```
1. Serializa o novo estado → string canônica
2. Calcula o hash → ID do novo nó
3. Busca o ID em nodes:
   ├── Encontrou (estado previsto): marca isPlayed = true
   └── Não encontrou (estado fora das previsões):
       → cria nó novo
       → vincula como filho do currentId
4. Atualiza currentId e appenda ao playedPath
5. Chama _expandChildren para prever os próximos estados
```

O passo 3 é particularmente interessante: na maioria das vezes, o jogador escolhe uma jogada que **já foi prevista** pelo sistema. Nesse caso, o nó já existe na árvore com `isPlayed = false`, e basta marcá-lo como jogado. Ocasionalmente (como após carregar um arquivo XML sem os filhos expandidos), o estado pode não existir — nesse caso é criado do zero.

---

## 8. Desfazer e Navegar pela História

### Desfazer uma jogada (`undo`)

```typescript
undo(): YinshGame | null {
  if (this.playedPath.length <= 1) return null;
  this.playedPath.pop();                              // remove o último
  this.currentId = playedPath[playedPath.length - 1]; // retrocede
  const node = nodes.get(this.currentId);
  return new YinshGame(serializedToState(node.stateSnapshot)); // restaura
}
```

O processo é simples: remove o último ID do `playedPath` e reconstrói o `YinshGame` a partir do snapshot do nó que agora é o atual. Os nós **não são deletados** da árvore — a história permanece intacta para eventual renavegação.

### Navegar para um nó específico (`navigateTo`)

Este método permite clicar diretamente em qualquer nó navegável da árvore e ir para aquele estado:

**Caso 1 — Voltar para um estado anterior (nó no `playedPath`):**
```
playedPath antes: ["abc1", "def2", "ghi3", "jkl4", "mno5"]
                                            ↑ clicou aqui
playedPath depois: ["abc1", "def2", "ghi3", "jkl4"]
currentId = "jkl4"
```
O `playedPath` é truncado até o nó clicado. Isso equivale a desfazer múltiplas jogadas de uma vez.

**Caso 2 — Avançar para um filho direto:**
Se o nó clicado é um filho do estado atual (um dos estados previstos), ele é marcado como `isPlayed = true`, adicionado ao `playedPath`, e seus filhos são expandidos.

### Identificando nós clicáveis (`getNavigableIds`)

Nem todos os nós da árvore são clicáveis — apenas os que fazem sentido para navegação:

```
navigableIds = { todos os nós em playedPath EXCETO o atual }
             ∪ { todos os filhos diretos do nó atual }
```

Nós em outros ramos (que nunca foram jogados e não são filhos do atual) **não são clicáveis**. Isso evita saltos arbitrários para estados sem relação com a partida atual.

---

## 9. Persistência: Salvando e Carregando em XML

A árvore inteira pode ser exportada para um arquivo XML e reimportada posteriormente, permitindo salvar e continuar uma partida mais tarde.

### 9.1 Estrutura do Arquivo XML

```xml
<?xml version="1.0" encoding="UTF-8"?>
<yinshTree>

  <!-- Metadados de navegação -->
  <meta>
    <rootId>3f8a2c1d</rootId>
    <currentId>a7b3c9e2</currentId>
    <playedPath>3f8a2c1d,8b1d4f2a,a7b3c9e2</playedPath>
  </meta>

  <!-- Todos os nós da árvore -->
  <nodes>

    <node id="3f8a2c1d">
      <depth>0</depth>
      <move></move>                     <!-- raiz não tem jogada -->
      <isPlayed>true</isPlayed>
      <parentId></parentId>             <!-- raiz não tem pai -->
      <childIds>8b1d4f2a,cc3e7a1b,d4f29801</childIds>
      <snapshot>
        <currentPlayer>white</currentPlayer>
        <phase>place-marker</phase>
        <ringsPlaced white="5" black="5"/>
        <ringsRemoved white="0" black="0"/>
        <selectedRing></selectedRing>
        <runRemovalPlayer></runRemovalPlayer>
        <winner></winner>
        <board>
          <cell key="-2,1" val="W_RING"/>
          <cell key="-1,0" val="B_RING"/>
          <!-- apenas células não-vazias são salvas -->
        </board>
      </snapshot>
    </node>

    <node id="8b1d4f2a">
      <depth>1</depth>
      <move>-2,1→0,1</move>            <!-- anel em -2,1 moveu para 0,1 -->
      <isPlayed>true</isPlayed>
      <parentId>3f8a2c1d</parentId>
      <childIds>a7b3c9e2,f1e2d3c4</childIds>
      <snapshot>...</snapshot>
    </node>

    <!-- nós não jogados (previstos) também são salvos -->
    <node id="cc3e7a1b">
      <depth>1</depth>
      <move>-2,1→1,-1</move>
      <isPlayed>false</isPlayed>
      <parentId>3f8a2c1d</parentId>
      <childIds></childIds>
      <snapshot>...</snapshot>
    </node>

  </nodes>
</yinshTree>
```

### 9.2 Decisões de Design do Formato

**Por que XML e não JSON?**
XML permite estrutura hierárquica com atributos e elementos aninhados de forma natural, sendo ideal para dados de árvore. Além disso, é um formato legível por humanos e suportado nativamente pelo browser via `DOMParser`.

**Por que salvar apenas células não-vazias no board?**
Das 85 posições do tabuleiro, a maioria está vazia na maior parte da partida. Salvar apenas as células com peças reduz significativamente o tamanho do arquivo. Ao carregar, as células ausentes são interpretadas como `null`.

**Por que salvar os nós não-jogados (`isPlayed = false`)?**
Para que ao carregar o arquivo, a árvore esteja completa com todas as previsões já calculadas. Sem isso, seria necessário recalcular os filhos de cada nó ao carregar, o que aumentaria o tempo de inicialização.

**Segurança contra XML malicioso:**
Todos os valores inseridos no XML passam pela função `esc()` que escapa os 4 caracteres especiais do XML: `&` → `&amp;`, `<` → `&lt;`, `>` → `&gt;`, `"` → `&quot;`. Isso garante que coordenadas ou descrições de jogadas não quebrem a estrutura do XML.

### 9.3 Processo de Salvamento

```typescript
saveToFile(filename = "yinsh_tree.xml"): void {
  const blob = new Blob([this.toXML()], { type: "application/xml" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
```

O nome do arquivo inclui o timestamp Unix (`yinsh_tree_1715275200000.xml`), garantindo nomes únicos a cada salvamento. O processo usa a API de download do browser sem servidor backend.

### 9.4 Processo de Carregamento

```typescript
static async loadFromFile(file: File): Promise<GameStateTree> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const tree = GameStateTree.fromXML(e.target.result as string);
      resolve(tree);
    };
    reader.onerror = reject;
    reader.readAsText(file);
  });
}
```

O `fromXML()` reconstrói a árvore completa:
1. Usa `DOMParser` nativo do browser para parsear o XML.
2. Lê os metadados (`rootId`, `currentId`, `playedPath`).
3. Para cada `<node>`, reconstrói o `TreeNodeData` completo incluindo o board.
4. Após reconstruir todos os nós, repopula o `Set seenStates` — essencial para que o mecanismo anti-duplicação funcione corretamente nas próximas expansões.

---

## 10. Integração com a Interface React

A classe `GameStateTree` é pura TypeScript (sem React). O hook `useGameTree` serve como ponte entre a árvore e o React.

### O Problema: React e Mutação In-Place

React re-renderiza componentes quando o estado muda. A `GameStateTree` é **mutada in-place** (os nós são adicionados ao `Map` diretamente), sem criar um novo objeto. Se apenas a referência fosse usada como estado, React não detectaria as mudanças.

### A Solução: Wrapper com Contador de Versão

```typescript
const [holder, setHolder] = useState<{ tree: GameStateTree; v: number }>(...);
```

O estado contém:
- `tree`: a instância da árvore (mesma referência, mutada in-place)
- `v`: um contador inteiro incrementado a cada mudança

A função `bump()` cria um novo objeto wrapper sem clonar a árvore:
```typescript
const bump = () => setHolder((h) => ({ tree: h.tree, v: h.v + 1 }));
```

O `v` (exportado como `treeVersion`) é passado como prop para o componente de visualização (`GameTreeView`), onde é usado como dependência de `useMemo`. Isso garante que os cálculos de layout da árvore SVG sejam refeitos a cada mutação, mesmo que a referência de `tree` não mude.

### Supressão de Registro Duplo

Quando o estado do jogo é restaurado externamente (por undo, load ou navegação), o hook `useYinshGame` detecta a mudança de estado e tentaria registrá-la na árvore novamente — o que criaria um nó duplicado ou corromperia o `playedPath`.

A solução é uma flag `suppressNextRecordRef`:

```
navigateToNode(id)
  → tree.navigateTo(id)              (árvore atualizada)
  → applyRestoredGame(restoredGame)  (tabuleiro atualizado)
      → suppressNextRecordRef = true
      → performAction() atualiza state
          → useEffect detecta mudança
          → suppressNextRecordRef é true → NÃO registra
          → limpa a flag
```

---

## 11. Visualização: Como a Árvore é Desenhada

A classe `GameStateTree` fornece os dados; o componente `GameTreeView.tsx` os renderiza como um SVG interativo.

### Algoritmo de Layout (Reingold-Tilford Simplificado)

O posicionamento dos nós usa um algoritmo bottom-up / top-down:

**Fase 1 — Calcular larguras (bottom-up):**
Para cada nó, calcula a largura necessária para acomodar toda a sua sub-árvore. Folhas têm largura fixa de 120px. Nós internos têm largura igual à soma das larguras dos filhos mais os gaps entre eles.

**Fase 2 — Posicionar nós (top-down):**
A raiz é centralizada. Cada nó distribui seus filhos horizontalmente de forma centralizada. A profundidade determina a posição vertical: `y = depth × (54 + 60)`.

### Colapso de Folhas (Virtual Groups)

Para evitar que a árvore fique impraticavelmente larga (um estado pode ter 80+ filhos possíveis na fase de colocar anéis), folhas que **não fazem parte do caminho jogado e não são filhas do nó atual** são agrupadas em um único **nó virtual** exibido com `⋯`. O usuário pode clicar para expandir o grupo e ver todos os ramos.

### Scroll Automático

Após cada jogada ou navegação, a interface rola automaticamente para centralizar o nó atual na tela. Isso usa a posição calculada pelo algoritmo de layout para calcular o offset de scroll do container HTML — `scrollIntoView` não funciona para elementos SVG dentro de containers `overflow: auto`.

---

## 12. Resumo do Ciclo Completo

```
                     Jogador faz uma jogada
                              │
                    handleCellClick(coord)
                              │
                    useYinshGame → game.clone() → ação
                              │
                    state muda → useEffect detecta
                              │
                    recordMove(newGame) → applyMove()
                              │
              ┌───────────────┴───────────────────┐
              │                                   │
    Nó já existe?                        Nó não existe?
    (estado previsto)                    (estado novo)
              │                                   │
    isPlayed = true               Cria nó, vincula ao pai
              │                                   │
              └───────────────┬───────────────────┘
                              │
                    currentId = novo nó
                    playedPath.push(id)
                              │
                    _expandChildren()
                    → generateChildGames()
                    → valida via motor do jogo
                    → armazena filhos com isPlayed=false
                              │
                    bump() → React re-renderiza
                              │
                    GameTreeView recalcula layout
                    → scroll para nó atual
                    → renderiza SVG atualizado
```

---

*Apresentação elaborada com base no código-fonte de `GameStateTree.ts`, `useGameTree.ts` e `GameTreeView.tsx`.*
