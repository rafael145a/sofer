BUG Edição

Status (atualizado 2026-06-17):
✅ corrigido · ⬜ pendente
Lotes concluídos: Quick wins (#15/#16/#17), Cluster A clipboard (#7/#8/#14), Cluster B comentários (#2/#3/#5), #1 cursor, #4 imagem frente do texto.

✅ 1 - cursor volta quando digita muito rápido — fix do guarda de selectionchange (determinístico, sem timer) - não volta mas pisca no começo → RESOLVIDO o piscar: cada tecla gera 2 commits React; no 1º a seleção do modelo já está em N+1 mas o text node ainda tem N chars, então `locatePoint` estourava o container e caía no fallback `{container, offset:0}` (início da linha) por 1 frame. Fix em `dom-bridge.ts`: offset fora do alcance agora clampa pro FIM do último text node (não pro início do container) + `applyDomSelection` vira no-op quando os pontos já batem (evita o blink do `removeAllRanges`). Teste de regressão em `dom-bridge.test.ts` (locatePoint clampa offset fora do alcance). Verificado o mecanismo no playground (estado intermediário `el:DIV @0` sumiu); falta confirmação visual do usuário. - ok

✅ 2 - caixas de comentários não aparece em tempo real (quando resolve algum comentário ele atualiza e aparece outros comentários) — Cluster B -ok
✅ 3 - resolver não atualiza em tempo real (ele so atualiza quando resolve algum) — Cluster B - ok

✅ 4 - botão imagem frente do texto não funciona. o texto permance na frente da imagem — isolar só blocos com imagem "behind" (`:has()`), liberando "front" para escapar do bloco - ok

✅ 5 - Quando resolve o comentario ele não aparece o texto que foi utilizado para fazer o comentário — Cluster B (coluna trecho_citado persistida)
✅ 6 - inserir link vinculado algum texto não funciona — o modal colapsava a seleção do modelo (refoco do editor ao fechar → selectionchange) e o `setMark` do consumidor virava no-op. Fix core: `requestLink` captura a seleção, `resolveLinkRequest` restaura antes de resolver. Verificado red→green no playground.

✅ 7 - ctrl+C em imagem não funciona — Cluster A - OK

✅ 8 - ctrl+c copia o texto porem na hora de colar ele cola sem formatação — Cluster A - ok

✅ 9 - quando move a imagem de uma pagina para outra ela some atras da paginação — core `moveEmbedAnchor` + **detecção de página destino por GEOMETRIA** (trocado o `elementFromPoint`, que falhava no vão entre páginas → prendia/clipava no fundo da pág.1) + **clamp no re-âncora**. VERIFICADO com drag frame-a-frame em 4 pontos de soltura (inclusive o vão na borda) → re-ancora na página certa e fica TOTALMENTE visível. (Bônus: corrigida regressão do #11 que quebrou o arrastar de imagem flutuante — overlay move o `.ed-figure`, não o `<img>` estático.) Tier 2 (UX) FEITO: preview translúcido no overlay (não-clipado) durante o arraste + esconde a imagem real → a imagem fica visível ao cruzar a borda; some no drop. Após re-ancorar, o overlay aparece de imediato (selecionável na hora). Verificado frame-a-frame + visual. - ok

✅ 11 - quando coloca legenda na imagem fica lagada — render estrutura-estável: sempre <figure> (figcaption condicional), o <img> nunca remonta → sem re-decode síncrono do base64

✅ 14 - CTRL + x não funciona ,ele acaba copiando em vez de recortar — Cluster A - ok
✅ 15 - alinhamento de texto dentro da tabela não funciona — Quick wins - ok
✅ 16 - quando cria a tabela vc não consegue escrever abaixo da tabela — Quick wins - ok

✅ 17 - Ao imprimir, remover os cursores — Quick wins
✅ 18 - listas dentro de tabela não funcionam — causa-raiz: célula é um `Y.Text` plano sem estrutura de blocos, e lista é um tipo de BLOCO; os comandos guardavam contra célula de propósito (`commands.ts:736/763/784`). Fix: `CellAttrs.listKind` + cada linha separada por `\n` vira um item. A investigação desenterrou DOIS defeitos silenciosos que ninguém tinha reportado: o import de .docx descartava `<w:numPr>` dentro de célula (três parágrafos numerados viravam texto sem marcador), e célula multilinha exportava para DOCX como UMA linha (`"um dois tres"`), porque `makeCell` emitia um único `<w:p>` e `deltaToRuns` troca `\n` por espaço — este último já afetava qualquer célula multilinha, com ou sem lista. Sem recuo por item na v1 (`Y.Text` plano não guarda atributo por linha).
