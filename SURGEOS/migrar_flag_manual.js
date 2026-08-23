// migrar_flag_manual.js
//
// O que este script faz:
// Marca retroativamente com "manual: true" todos os registros da coleção
// "servicos" que têm pontos > 150 e ainda não têm essa flag. Isso corrige
// registros ANTIGOS (salvos antes do ajuste no index.html) que estavam
// sendo excluídos por engano do "Total de Pontos" oficial, mesmo sendo
// lançamentos legítimos do campo "INSERIR TOTAL DE PONTOS DA RV MANUALMENTE"
// (o próprio campo foi feito para aceitar valores grandes, tipo 2359).
//
// IMPORTANTE: presume que TODO registro antigo com pontos > 150 é um
// lançamento manual legítimo (é a mesma regra de 150 pts que o site já usa
// para diferenciar "serviço normal" de "total de RV digitado de uma vez").
// Se algum desses registros for na verdade um erro de digitação, use o
// backup gerado por backup_servicos.js para identificar e corrigir esse
// caso manualmente pela tela (editar o registro).
//
// Como rodar:
//   1) RODE PRIMEIRO: node backup_servicos.js  (gera backup antes de mexer em nada)
//   2) Coloque a serviceAccountKey.json (chave NOVA) nesta mesma pasta, se ainda não tiver
//   3) npm install
//   4) node migrar_flag_manual.js

const { initializeApp, cert } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const serviceAccount = require("./serviceAccountKey.json");

initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

const LIMITE_PONTOS_SUSPEITO_GLOBAL = 150;
const LIMITE_BATCH = 400;

async function main() {
  console.log("Lendo coleção 'servicos' do Firestore...");
  const snapshot = await db.collection("servicos").get();

  let candidatos = 0;
  let atualizados = 0;
  let batch = db.batch();
  let contadorBatch = 0;

  for (const doc of snapshot.docs) {
    const dados = doc.data();
    const pts = Number(dados.pontos) || 0;

    if (pts > LIMITE_PONTOS_SUSPEITO_GLOBAL) {
      candidatos++;
      if (dados.manual !== true) {
        batch.update(doc.ref, { manual: true });
        atualizados++;
        contadorBatch++;
        console.log(`  -> ${doc.id} | colaborador: ${dados.colaborador || '?'} | data: ${dados.data || '?'} | pontos: ${pts}`);

        if (contadorBatch >= LIMITE_BATCH) {
          await batch.commit();
          batch = db.batch();
          contadorBatch = 0;
        }
      }
    }
  }

  if (contadorBatch > 0) await batch.commit();

  console.log(`\nRegistros com pontos > ${LIMITE_PONTOS_SUSPEITO_GLOBAL}: ${candidatos}`);
  console.log(`✔ Registros atualizados com manual:true: ${atualizados}`);
  console.log(candidatos === atualizados
    ? "Todos já estavam corretos ou foram corrigidos agora."
    : `${candidatos - atualizados} já estavam com manual:true e não precisaram de alteração.`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Erro na migração:", err);
  process.exit(1);
});
