// limpar_duplicados_protocolo.js
//
// O que este script faz:
// Reproduz exatamente a mesma lógica de "registros válidos" usada na tela
// principal e na Auditoria Completa (função filtrarRegistrosValidosMes do
// index.html): agrupa os registros da coleção "servicos" por colaborador +
// mês, e para cada Nº de Protocolo/OS repetido dentro do mesmo grupo,
// mantém apenas a 1ª ocorrência (mais antiga, por criadoEm) e marca as
// demais como duplicadas.
//
// Isso faz a "Soma Bruta na Nuvem" da Auditoria passar a bater exatamente
// com o "Total de Pontos" oficial — hoje eles ficam diferentes porque os
// duplicados continuam existindo na nuvem, só ficam escondidos do total.
//
// SEGURANÇA:
// - Roda em modo LISTAGEM por padrão: mostra tudo que seria excluído, mas
//   NÃO apaga nada até você digitar CONFIRMAR quando for perguntado.
// - Faça o backup antes (node backup_servicos.js) — se digitar CONFIRMAR
//   e algo sair errado, o backup é o jeito de conferir/reverter.
//
// Como rodar:
//   1) RODE PRIMEIRO: node backup_servicos.js
//   2) node limpar_duplicados_protocolo.js

const { initializeApp, cert } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const readline = require("readline");
const serviceAccount = require("./serviceAccountKey.json");

initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

const LIMITE_BATCH = 400;

function perguntar(pergunta) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(pergunta, (resposta) => { rl.close(); resolve(resposta); }));
}

// Mesma chave de agrupamento usada na tela (colaborador + ano/mês extraído
// do campo "data", formato YYYY-MM-DD).
function chaveGrupo(dados) {
  const [ano, mes] = (dados.data || "").split("-");
  return `${dados.colaborador || "?"}__${ano || "?"}-${mes || "?"}`;
}

async function main() {
  console.log("Lendo coleção 'servicos' do Firestore...\n");
  const snapshot = await db.collection("servicos").get();

  const todos = [];
  snapshot.forEach((doc) => todos.push({ firebaseId: doc.id, ...doc.data() }));

  // Agrupa por colaborador + mês
  const grupos = {};
  for (const reg of todos) {
    const chave = chaveGrupo(reg);
    if (!grupos[chave]) grupos[chave] = [];
    grupos[chave].push(reg);
  }

  const duplicados = [];

  for (const chave of Object.keys(grupos)) {
    const lista = grupos[chave].slice().sort((a, b) => (a.criadoEm || 0) - (b.criadoEm || 0));
    const protocolosVistos = new Set();

    for (const reg of lista) {
      const protocolo = (reg.protocolo || "").trim();
      if (!protocolo) continue; // sem protocolo nunca é considerado duplicado

      if (protocolosVistos.has(protocolo)) {
        duplicados.push(reg);
      } else {
        protocolosVistos.add(protocolo);
      }
    }
  }

  if (duplicados.length === 0) {
    console.log("✔ Nenhum protocolo duplicado encontrado. A nuvem já está igual ao total oficial.");
    process.exit(0);
  }

  console.log(`Encontrados ${duplicados.length} registro(s) duplicado(s) (serão EXCLUÍDOS, mantendo a 1ª ocorrência de cada protocolo):\n`);
  for (const reg of duplicados) {
    console.log(`  - ID: ${reg.firebaseId} | Colaborador: ${reg.colaborador} | Data: ${reg.data} | Protocolo: ${reg.protocolo} | Pontos: ${reg.pontos} | Cliente: ${reg.nomeCliente || '-'}`);
  }

  const resposta = await perguntar(
    `\nDigite CONFIRMAR (em maiúsculas) para excluir estes ${duplicados.length} registro(s) da nuvem, ou qualquer outra coisa para cancelar: `
  );

  if (resposta.trim() !== "CONFIRMAR") {
    console.log("\nCancelado. Nada foi excluído.");
    process.exit(0);
  }

  let batch = db.batch();
  let contadorBatch = 0;

  for (const reg of duplicados) {
    batch.delete(db.collection("servicos").doc(reg.firebaseId));
    contadorBatch++;
    if (contadorBatch >= LIMITE_BATCH) {
      await batch.commit();
      batch = db.batch();
      contadorBatch = 0;
    }
  }
  if (contadorBatch > 0) await batch.commit();

  console.log(`\n✔ ${duplicados.length} registro(s) duplicado(s) excluído(s) da nuvem.`);
  console.log("A partir de agora, o Total Oficial e a Soma Bruta na Nuvem devem bater.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Erro:", err);
  process.exit(1);
});
