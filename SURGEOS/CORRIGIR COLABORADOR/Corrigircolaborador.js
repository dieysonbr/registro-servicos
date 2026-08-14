// ============================================================
// Script para corrigir registros de serviços cujo campo
// "colaborador" está vazio/indefinido, atribuindo-os a um
// colaborador específico (ex: CLEUBER SEIXAS).
//
// Como usar (no Git Bash):
//   1) npm install firebase-admin
//   2) node corrigirColaborador.js
//
// Requer o arquivo "serviceAccountKey.json" na mesma pasta.
// ============================================================

const { initializeApp, cert } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const serviceAccount = require("./serviceAccountKey.json");

// ⚠️ Ajuste aqui o nome do colaborador que deve RECEBER os registros:
const NOME_DESTINO = "CLEUBER SEIXAS";

initializeApp({
  credential: cert(serviceAccount)
});

const db = getFirestore();

function nomeInvalido(valor) {
  if (valor === undefined || valor === null) return true;
  if (typeof valor !== "string") return true;
  const limpo = valor.trim().toLowerCase();
  return limpo === "" || limpo === "undefined" || limpo === "null";
}

async function corrigir() {
  const snapshot = await db.collection("servicos").get();

  console.log(`Total de registros na coleção "servicos": ${snapshot.size}`);

  const docsParaCorrigir = [];
  snapshot.forEach((doc) => {
    const dados = doc.data();
    if (nomeInvalido(dados.colaborador)) {
      docsParaCorrigir.push(doc);
    }
  });

  console.log(`Registros sem colaborador válido encontrados: ${docsParaCorrigir.length}`);

  if (docsParaCorrigir.length === 0) {
    console.log("Nada para corrigir. Encerrando.");
    return;
  }

  // Mostra uma prévia antes de aplicar, para conferência
  console.log("\nPrévia dos registros que serão alterados:");
  docsParaCorrigir.forEach((doc) => {
    const d = doc.data();
    console.log(`  - id=${doc.id} | colaborador atual="${d.colaborador}" | pontos=${d.pontos} | data=${d.data}`);
  });

  // Aplica em lotes (Firestore permite até 500 operações por batch)
  const TAMANHO_LOTE = 450;
  for (let i = 0; i < docsParaCorrigir.length; i += TAMANHO_LOTE) {
    const lote = docsParaCorrigir.slice(i, i + TAMANHO_LOTE);
    const batch = db.batch();
    lote.forEach((doc) => {
      batch.update(doc.ref, { colaborador: NOME_DESTINO });
    });
    await batch.commit();
    console.log(`Lote ${i / TAMANHO_LOTE + 1} aplicado (${lote.length} registros).`);
  }

  console.log(`\n✅ Concluído! ${docsParaCorrigir.length} registros agora pertencem a "${NOME_DESTINO}".`);
}

corrigir().catch((erro) => {
  console.error("Erro ao corrigir registros:", erro);
});