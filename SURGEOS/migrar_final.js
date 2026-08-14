// migrar_final.js
//
// O que este script faz:
// 1. Remove numeração do início do nome de TODOS os colaboradores
//    (ex: "1. DIEYSON DE PAULA" -> "DIEYSON DE PAULA")
// 2. Renomeia "CLEUBER BARBOSA" -> "CLEUBER SEIXAS"
// 3. Atualiza TODOS os registros da coleção "servicos" para apontar
//    para o nome final correto, mantendo cada serviço atrelado
//    ao colaborador certo.
//
// Como rodar:
//   1) Coloque este arquivo na mesma pasta do serviceAccountKey.json
//      (use uma chave NOVA, já que a antiga deve ser revogada)
//   2) npm install
//   3) node migrar_final.js

const { initializeApp, cert } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const serviceAccount = require("./serviceAccountKey.json");

initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

// Renomeações manuais adicionais, além da remoção de numeração.
// Adicione outras aqui se precisar renomear mais alguém no futuro.
const renomeacoesManuais = {
  "CLEUBER BARBOSA": "CLEUBER SEIXAS",
};

function nomeFinal(nomeOriginal) {
  if (!nomeOriginal || typeof nomeOriginal !== "string") return null;
  let limpo = nomeOriginal.trim();
  if (!limpo) return null;
  // remove prefixos tipo "1. ", "12) ", "3- " no início do nome
  limpo = limpo.replace(/^\d+[\.\)\-]?\s*/, "").trim().toUpperCase();
  if (renomeacoesManuais[limpo]) limpo = renomeacoesManuais[limpo];
  return limpo;
}

async function migrarColaboradores() {
  const snapshot = await db.collection("colaboradores").get();
  const mapaAntigoParaNovo = {};

  for (const doc of snapshot.docs) {
    const nomeAntigo = doc.id;
    const nomeNovo = nomeFinal(nomeAntigo);
    mapaAntigoParaNovo[nomeAntigo] = nomeNovo;

    if (!nomeNovo || nomeNovo === nomeAntigo) continue; // já está correto

    const dados = doc.data();
    const refNovo = db.collection("colaboradores").doc(nomeNovo);
    const snapNovo = await refNovo.get();

    if (snapNovo.exists) {
      // Já existe um doc com o nome novo -> mescla, priorizando
      // quem já tiver senha pessoal cadastrada (precisaTrocar = false)
      const dadosExistentes = snapNovo.data();
      const usarExistente = dadosExistentes.precisaTrocar === false;
      const dadosFinais = {
        senha: usarExistente ? dadosExistentes.senha : dados.senha,
        precisaTrocar: usarExistente ? false : !!dados.precisaTrocar,
        ultimoAcesso: Math.max(dadosExistentes.ultimoAcesso || 0, dados.ultimoAcesso || 0) || null,
      };
      await refNovo.set(dadosFinais, { merge: true });
    } else {
      await refNovo.set(dados);
    }

    await doc.ref.delete();
    console.log(`✔ Colaborador: "${nomeAntigo}" -> "${nomeNovo}"`);
  }

  return mapaAntigoParaNovo;
}

async function migrarServicos() {
  const snapshot = await db.collection("servicos").get();
  let atualizados = 0;
  let batch = db.batch();
  let contadorBatch = 0;
  const LIMITE_BATCH = 400;

  for (const doc of snapshot.docs) {
    const dados = doc.data();
    const nomeAtual = dados.colaborador;
    const nomeNovo = nomeFinal(nomeAtual);

    if (nomeNovo && nomeNovo !== nomeAtual) {
      batch.update(doc.ref, { colaborador: nomeNovo });
      atualizados++;
      contadorBatch++;

      if (contadorBatch >= LIMITE_BATCH) {
        await batch.commit();
        batch = db.batch();
        contadorBatch = 0;
      }
    }
  }

  if (contadorBatch > 0) await batch.commit();
  console.log(`✔ ${atualizados} registro(s) de serviço atualizado(s) e re-atrelado(s) ao colaborador correto.`);
}

async function main() {
  console.log("Iniciando migração...\n");
  await migrarColaboradores();
  console.log("");
  await migrarServicos();
  console.log("\nMigração concluída com sucesso!");
  process.exit(0);
}

main().catch((err) => {
  console.error("Erro na migração:", err);
  process.exit(1);
});
