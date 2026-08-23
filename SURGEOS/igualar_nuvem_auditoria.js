// igualar_nuvem_auditoria.js
//
// O que este script faz:
// Reproduz EXATAMENTE a mesma lógica de "registros válidos" que a tela
// principal e a Auditoria Completa usam (função filtrarRegistrosValidosMes
// do index.html), agrupando por colaborador + mês, e:
//   1) marca como INVÁLIDO qualquer registro com pontos > 150 que NÃO
//      esteja marcado como manual:true (pontuação suspeita, não é um
//      lançamento legítimo do campo de pontos manuais da RV)
//   2) marca como INVÁLIDO qualquer registro cujo Nº de Protocolo/OS já
//      apareceu antes no mesmo grupo (mantém só a 1ª ocorrência, mais
//      antiga por criadoEm)
//
// Todo registro que a Auditoria Completa já mostra normalmente (ou seja,
// passou nos dois critérios acima) permanece EXATAMENTE como está na
// nuvem — não é tocado. Só os que a Auditoria hoje exclui do total são
// excluídos aqui de verdade.
//
// IMPORTANTE - ORDEM DE EXECUÇÃO:
//   1) node backup_servicos.js           (gera backup de tudo antes de mexer)
//   2) node migrar_flag_manual.js        (marca lançamentos manuais legítimos
//                                          como manual:true, para NÃO serem
//                                          excluídos por engano no passo 3)
//   3) node igualar_nuvem_auditoria.js   (este script)
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

  const grupos = {};
  for (const reg of todos) {
    const chave = chaveGrupo(reg);
    if (!grupos[chave]) grupos[chave] = [];
    grupos[chave].push(reg);
  }

  const invalidos = [];

  for (const chave of Object.keys(grupos)) {
    const lista = grupos[chave].slice().sort((a, b) => (a.criadoEm || 0) - (b.criadoEm || 0));
    const protocolosVistos = new Set();

    for (const reg of lista) {
      const pts = Number(reg.pontos) || 0;
      const protocolo = (reg.protocolo || "").trim();

      // Critério 1: pontuação suspeita (não-manual, acima do limite)
      if (!reg.manual && pts > LIMITE_PONTOS_SUSPEITO_GLOBAL) {
        invalidos.push({ ...reg, motivo: `pontuação suspeita (${pts} pts, não-manual)` });
        continue;
      }

      // Critério 2: protocolo duplicado (mantém só a 1ª ocorrência)
      if (protocolo) {
        if (protocolosVistos.has(protocolo)) {
          invalidos.push({ ...reg, motivo: `protocolo duplicado ("${protocolo}")` });
          continue;
        }
        protocolosVistos.add(protocolo);
      }
    }
  }

  if (invalidos.length === 0) {
    console.log("✔ Nenhum registro inválido encontrado. A nuvem já está igual à Auditoria Completa.");
    process.exit(0);
  }

  console.log(`Encontrados ${invalidos.length} registro(s) que NÃO aparecem na Auditoria Completa (serão EXCLUÍDOS da nuvem):\n`);
  for (const reg of invalidos) {
    console.log(`  - ID: ${reg.firebaseId} | Colaborador: ${reg.colaborador} | Data: ${reg.data} | Protocolo: ${reg.protocolo || '(sem protocolo)'} | Pontos: ${reg.pontos} | Cliente: ${reg.nomeCliente || '-'} | Motivo: ${reg.motivo}`);
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

  console.log(`\n✔ ${invalidos.length} registro(s) excluído(s) da nuvem.`);
  console.log("A nuvem agora contém exatamente os mesmos registros que aparecem na Auditoria Completa.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Erro:", err);
  process.exit(1);
});
