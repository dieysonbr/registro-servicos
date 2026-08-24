// manter_apenas_lista_auditoria.js
//
// O que este script faz:
// Lê o arquivo "auditoria_referencia.txt" (exportado direto da tela de
// Auditoria Completa, com os IDs reais da nuvem de cada registro) e usa
// ele como a lista EXATA de registros que devem permanecer na coleção
// "servicos". Qualquer documento que estiver na nuvem mas NÃO estiver
// nessa lista é excluído.
//
// Isso é mais preciso que um script baseado em regras (tipo
// limpar_pontuacao_suspeita.js), porque usa a lista exata que você
// conferiu visualmente na Auditoria Completa, em vez de tentar adivinhar
// por uma fórmula quais registros são "suspeitos".
//
// Formato esperado de auditoria_referencia.txt: texto colado da tabela da
// Auditoria (separado por TAB), com colunas Data / Protocolo / Cliente /
// Serviço / Pontos / ID (nuvem) / Ação. O ID (nuvem) é sempre a 6ª coluna.
//
// IMPORTANTE - ORDEM DE EXECUÇÃO:
//   1) node backup_servicos.js                    (gera backup de tudo antes de mexer)
//   2) node manter_apenas_lista_auditoria.js       (este script)
//
// SEGURANÇA: roda em modo LISTAGEM por padrão — mostra tudo que seria
// excluído, mas só apaga de verdade depois que você digitar CONFIRMAR.

const { initializeApp, cert } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const readline = require("readline");
const fs = require("fs");
const serviceAccount = require("./serviceAccountKey.json");

initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

const LIMITE_BATCH = 400;
const ARQUIVO_REFERENCIA = "./auditoria_referencia.txt";

function perguntar(pergunta) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(pergunta, (resposta) => { rl.close(); resolve(resposta); }));
}

function lerIdsParaManter() {
  const conteudo = fs.readFileSync(ARQUIVO_REFERENCIA, "utf-8");
  const linhas = conteudo.split(/\r?\n/);

  const ids = new Set();
  for (const linha of linhas) {
    if (!linha.trim()) continue;
    const colunas = linha.split("\t");
    if (colunas.length < 6) continue; // pula cabeçalho/linhas malformadas

    const idNuvem = (colunas[5] || "").trim();
    // Ignora a própria linha de cabeçalho ("ID (nuvem)")
    if (!idNuvem || idNuvem === "ID (nuvem)") continue;

    ids.add(idNuvem);
  }
  return ids;
}

async function main() {
  console.log(`Lendo lista de referência de "${ARQUIVO_REFERENCIA}"...`);
  const idsParaManter = lerIdsParaManter();
  console.log(`✔ ${idsParaManter.size} ID(s) encontrados na lista de referência.\n`);

  console.log("Lendo coleção 'servicos' do Firestore...\n");
  const snapshot = await db.collection("servicos").get();

  const todos = [];
  snapshot.forEach((doc) => todos.push({ firebaseId: doc.id, ...doc.data() }));

  const paraExcluir = todos.filter((reg) => !idsParaManter.has(reg.firebaseId));
  const idsEncontradosNaNuvem = new Set(todos.map((r) => r.firebaseId));
  const idsNaListaMasNaoNaNuvem = [...idsParaManter].filter((id) => !idsEncontradosNaNuvem.has(id));

  if (idsNaListaMasNaoNaNuvem.length > 0) {
    console.log(`⚠ Aviso: ${idsNaListaMasNaoNaNuvem.length} ID(s) da lista de referência não foram encontrados na nuvem (podem já ter sido excluídos antes): ${idsNaListaMasNaoNaNuvem.join(", ")}\n`);
  }

  if (paraExcluir.length === 0) {
    console.log("✔ A nuvem já contém exatamente os mesmos registros da lista de referência. Nada a excluir.");
    process.exit(0);
  }

  const somaExcluir = paraExcluir.reduce((acc, r) => acc + (Number(r.pontos) || 0), 0);
  const somaManter = todos.reduce((acc, r) => acc + (Number(r.pontos) || 0), 0) - somaExcluir;

  console.log(`Encontrados ${paraExcluir.length} registro(s) na nuvem que NÃO estão na lista de referência (serão EXCLUÍDOS):\n`);
  for (const reg of paraExcluir) {
    console.log(`  - ID: ${reg.firebaseId} | Colaborador: ${reg.colaborador} | Data: ${reg.data} | Protocolo: ${reg.protocolo || '(sem protocolo)'} | Pontos: ${reg.pontos} | Cliente: ${reg.nomeCliente || '-'}`);
  }
  console.log(`\nSoma dos que serão excluídos: ${somaExcluir} pts`);
  console.log(`Soma dos que vão permanecer: ${somaManter} pts`);

  const resposta = await perguntar(
    `\nDigite CONFIRMAR (em maiúsculas) para excluir estes ${paraExcluir.length} registro(s) da nuvem, ou qualquer outra coisa para cancelar: `
  );

  if (resposta.trim() !== "CONFIRMAR") {
    console.log("\nCancelado. Nada foi excluído.");
    process.exit(0);
  }

  let batch = db.batch();
  let contadorBatch = 0;

  for (const reg of paraExcluir) {
    batch.delete(db.collection("servicos").doc(reg.firebaseId));
    contadorBatch++;
    if (contadorBatch >= LIMITE_BATCH) {
      await batch.commit();
      batch = db.batch();
      contadorBatch = 0;
    }
  }
  if (contadorBatch > 0) await batch.commit();

  console.log(`\n✔ ${paraExcluir.length} registro(s) excluído(s) da nuvem.`);
  console.log(`A nuvem agora deve somar aproximadamente ${somaManter} pts (confira na Auditoria Completa / Recalcular Totais).`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Erro:", err);
  process.exit(1);
});
