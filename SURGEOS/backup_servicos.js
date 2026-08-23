// backup_servicos.js
//
// Exporta um backup completo da coleção "servicos" (todos os registros de
// pontos de todos os colaboradores) para um arquivo JSON local, ANTES de
// rodar qualquer script de migração/correção de dados. Se algo der errado
// na migração, este arquivo permite conferir/restaurar os valores originais.
//
// Como rodar:
//   1) Coloque a serviceAccountKey.json (chave NOVA) nesta mesma pasta
//   2) npm install
//   3) node backup_servicos.js
//
// Gera um arquivo tipo: backup_servicos_2026-08-23T20-15-00.json

const { initializeApp, cert } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const fs = require("fs");
const serviceAccount = require("./serviceAccountKey.json");

initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

async function main() {
  console.log("Lendo coleção 'servicos' do Firestore...");
  const snapshot = await db.collection("servicos").get();

  const registros = [];
  snapshot.forEach((doc) => {
    registros.push({ firebaseId: doc.id, ...doc.data() });
  });

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const nomeArquivo = `backup_servicos_${timestamp}.json`;

  fs.writeFileSync(nomeArquivo, JSON.stringify(registros, null, 2), "utf-8");

  console.log(`\n✔ Backup concluído: ${registros.length} registro(s) salvos em "${nomeArquivo}"`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Erro ao gerar backup:", err);
  process.exit(1);
});
