// conceder_admin.js
//
// Substitui o configurar_senha_admin.js.
//
// Antes, ser administrador era saber uma senha guardada em texto puro no
// documento admin/config — e as regras permitiam que qualquer sessão lesse
// esse documento. Qualquer visitante do site conseguia a senha do admin.
//
// Agora a permissão é uma custom claim no token do Firebase Auth. Ela não é
// legível pelo navegador de terceiros, não pode ser escrita pelo cliente, e
// vale por conta — não por senha compartilhada.
//
// Como rodar:
//   node conceder_admin.js                      # lista quem é admin hoje
//   node conceder_admin.js "Dieyson de Paula"   # concede
//   node conceder_admin.js "Fulano" --revogar   # revoga

const { initializeApp, cert } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { getAuth } = require("firebase-admin/auth");

const { carregar } = require("./chave");

const { credencial } = carregar();
initializeApp({ credential: cert(credencial) });
const db = getFirestore();
const auth = getAuth();

const args = process.argv.slice(2);
const REVOGAR = args.includes("--revogar");
const nome = args.filter((a) => !a.startsWith("--"))[0];

async function listar() {
  const snap = await db.collection("colaboradores").get();
  console.log("\n  Administradores:\n");

  let achou = false;
  for (const d of snap.docs) {
    const uid = d.data().uid;
    if (!uid) continue;
    try {
      const u = await auth.getUser(uid);
      if (u.customClaims && u.customClaims.admin === true) {
        console.log(`    ✔ ${d.id}`);
        achou = true;
      }
    } catch {
      // Usuário do Auth removido mas o documento sobrou — o doctor do
      // repositório trata; aqui só não listamos.
    }
  }

  if (!achou) console.log("    (nenhum)");
  console.log('\n  Para conceder:  node conceder_admin.js "Nome do Colaborador"\n');
}

async function alterar() {
  const ref = db.collection("colaboradores").doc(nome);
  const doc = await ref.get();

  if (!doc.exists) {
    console.error(`\n✖ Colaborador "${nome}" não existe no Firestore.`);
    console.error("  O nome precisa bater exatamente, inclusive acentos e maiúsculas.\n");
    process.exit(1);
  }

  const uid = doc.data().uid;
  if (!uid) {
    console.error(`\n✖ "${nome}" ainda não tem uid — rode migrar_para_auth.js --aplicar antes.\n`);
    process.exit(1);
  }

  const usuario = await auth.getUser(uid);
  const claims = { ...(usuario.customClaims || {}) };

  if (REVOGAR) delete claims.admin;
  else claims.admin = true;

  await auth.setCustomUserClaims(uid, claims);

  console.log(`\n✔ ${nome}: administrador ${REVOGAR ? "revogado" : "concedido"}`);
  console.log("  A claim entra no token na próxima renovação — peça para sair");
  console.log("  e entrar de novo no site.\n");
}

(nome ? alterar() : listar()).catch((e) => {
  console.error("\nErro:", e.message, "\n");
  process.exit(1);
});
