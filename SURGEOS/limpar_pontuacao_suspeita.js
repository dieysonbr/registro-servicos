// limpar_pontuacao_suspeita.js
//
// O que este script faz:
// Remove da nuvem SOMENTE os registros com pontuação suspeita (pontos > 150
// e NÃO marcados como manual:true) — são os registros que "inflam" a Soma
// Bruta na Nuvem além do que a Auditoria Completa realmente reconhece como
// válido (ex: você fez 9 serviços somando 700 pts, mas a nuvem contabiliza
// mais do que isso por causa de algum lançamento errado com pontuação alta).
//
// IMPORTANTE — o que este script NÃO faz:
// NÃO mexe em protocolos duplicados. Registros com protocolo repetido que
// já existem na nuvem ficam exatamente como estão (por decisão explícita:
// a correção de duplicidade vale só para lançamentos NOVOS a partir de
// agora — o formulário já bloqueia isso na hora de salvar).
//
// IMPORTANTE - ORDEM DE EXECUÇÃO:
//   1) node backup_servicos.js              (gera backup de tudo antes de mexer)
//   2) node migrar_flag_manual.js           (marca lançamentos manuais legítimos
//                                             como manual:true, para NÃO serem
//                                             excluídos por engano no passo 3)
//   3) node limpar_pontuacao_suspeita.js    (este script)
//
// SEGURANÇA: roda em modo LISTAGEM por padrão — mostra tudo que seria
// excluído, mas só apaga de verdade depois que você digitar CONFIRMAR.

const { initializeApp, cert } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const readline = require("readline");
const serviceAccount = require("./serviceAccountKey.json");

initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

const LIMITE_PONTOS_SUSPEITO_GLOBAL = 150;
const LIMITE_BATCH = 400;

function perguntar(pergunta) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(pergunta, (resposta) => { rl.close(); resolve(resposta); }));
}

async function main() {
  console.log("Lendo coleção 'servicos' do Firestore...\n");
  const snapshot = await db.collection("servicos").get();

  const invalidos = [];
  snapshot.forEach((doc) => {
    const dados = doc.data();
    const pts = Number(dados.pontos) || 0;

    // Único critério: pontuação suspeita e NÃO marcada como manual
    if (!dados.manual && pts > LIMITE_PONTOS_SUSPEITO_GLOBAL) {
      invalidos.push({ firebaseId: doc.id, ...dados });
    }
  });

  if (invalidos.length === 0) {
    console.log("✔ Nenhum registro com pontuação suspeita encontrado. Nada a fazer.");
    process.exit(0);
  }

  console.log(`Encontrados ${invalidos.length} registro(s) com pontuação suspeita (> ${LIMITE_PONTOS_SUSPEITO_GLOBAL} pts, não-manual) — serão EXCLUÍDOS da nuvem:\n`);
  for (const reg of invalidos) {
    console.log(`  - ID: ${reg.firebaseId} | Colaborador: ${reg.colaborador} | Data: ${reg.data} | Protocolo: ${reg.protocolo || '(sem protocolo)'} | Pontos: ${reg.pontos} | Cliente: ${reg.nomeCliente || '-'}`);
  }

  const resposta = await perguntar(
    `\nDigite CONFIRMAR (em maiúsculas) para excluir estes ${invalidos.length} registro(s) da nuvem, ou qualquer outra coisa para cancelar: `
  );

  if (resposta.trim() !== "CONFIRMAR") {
    console.log("\nCancelado. Nada foi excluído.");
    process.exit(0);
  }

  let batch = db.batch();
  let contadorBatch = 0;

  for (const reg of invalidos) {
    batch.delete(db.collection("servicos").doc(reg.firebaseId));
    contadorBatch++;
    if (contadorBatch >= LIMITE_BATCH) {
      await batch.commit();
      batch = db.batch();
      contadorBatch = 0;
    }
  }
  if (contadorBatch > 0) await batch.commit();

  console.log(`\n✔ ${invalidos.length} registro(s) de pontuação suspeita excluído(s) da nuvem.`);
  console.log("Registros com protocolo duplicado NÃO foram tocados (ficam como estão).");
  process.exit(0);
}

main().catch((err) => {
  console.error("Erro:", err);
  process.exit(1);
});
