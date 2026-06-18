BUG Edição

Status (atualizado 2026-06-17):
✅ corrigido · ⬜ pendente
Lotes concluídos: Quick wins (#15/#16/#17), Cluster A clipboard (#7/#8/#14), Cluster B comentários (#2/#3/#5), #1 cursor, #4 imagem frente do texto.

✅ 1 - cursor volta quando digita muito rápido — fix do guarda de selectionchange (determinístico, sem timer) - não volta mas pisca no começo
✅ 2 - caixas de comentários não aparece em tempo real (quando resolve algum comentário ele atualiza e aparece outros comentários) — Cluster B
✅ 3 - resolver não atualiza em tempo real (ele so atualiza quando resolve algum) — Cluster B
✅ 4 - botão imagem frente do texto não funciona. o texto permance na frente da imagem — isolar só blocos com imagem "behind" (`:has()`), liberando "front" para escapar do bloco
✅ 5 - Quando resolve o comentario ele não aparece o texto que foi utilizado para fazer o comentário — Cluster B (coluna trecho_citado persistida)
✅ 6 - inserir link vinculado algum texto não funciona — o modal colapsava a seleção do modelo (refoco do editor ao fechar → selectionchange) e o `setMark` do consumidor virava no-op. Fix core: `requestLink` captura a seleção, `resolveLinkRequest` restaura antes de resolver. Verificado red→green no playground.
✅ 7 - ctrl+C em imagem não funciona — Cluster A
✅ 8 - ctrl+c copia o texto porem na hora de colar ele cola sem formatação — Cluster A
✅ 9 - quando move a imagem de uma pagina para outra ela some atras da paginação — core `moveEmbedAnchor` + **detecção de página destino por GEOMETRIA** (trocado o `elementFromPoint`, que falhava no vão entre páginas → prendia/clipava no fundo da pág.1) + **clamp no re-âncora**. VERIFICADO com drag frame-a-frame em 4 pontos de soltura (inclusive o vão na borda) → re-ancora na página certa e fica TOTALMENTE visível. (Bônus: corrigida regressão do #11 que quebrou o arrastar de imagem flutuante — overlay move o `.ed-figure`, não o `<img>` estático.) Tier 2 (UX) FEITO: preview translúcido no overlay (não-clipado) durante o arraste + esconde a imagem real → a imagem fica visível ao cruzar a borda; some no drop. Após re-ancorar, o overlay aparece de imediato (selecionável na hora). Verificado frame-a-frame + visual.
✅ 11 - quando coloca legenda na imagem fica lagada — render estrutura-estável: sempre <figure> (figcaption condicional), o <img> nunca remonta → sem re-decode síncrono do base64
✅ 14 - CTRL + x não funciona ,ele acaba copiando em vez de recortar — Cluster A
✅ 15 - alinhamento de texto dentro da tabela não funciona — Quick wins
✅ 16 - quando cria a tabela vc não consegue escrever abaixo da tabela — Quick wins
✅ 17 - Ao imprimir, remover os cursores — Quick wins
