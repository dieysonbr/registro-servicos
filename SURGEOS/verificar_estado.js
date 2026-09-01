// verificar_estado.js
//
// Mostra em que ponto da migração o sistema está. Só lê — não altera nada.
//
//   node verificar_estado.js

const { initializeApp, cert } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { getAuth } = require("firebase-admin/auth");
const { carregar } = require("./chave");

const { credencial } = carregar();
initializeApp({ credential: cert(credencial) });
const db = getFirestore();
const auth = getAuth();

const ok = (b) => (b ? "\x1b[32m✔\x1b[0m" : "\x1b[31m✖\x1b[0m");
const meio = "\x1b[33m~\x1b[0m";

async function main() {
  console.log("\n" + "=".repeat(60));
  console.log("  ESTADO DA MIGRAÇÃO — projeto surgeos");
  console.log("=".repeat(60) + "\n");

  // ---- 1. Provedor e-mail/senha -------------------------------------
  // O Admin SDK cria usuários independentemente da configuração do
  // provedor, então testamos pela API pública de autenticação: é ela que
  // o navegador usa, e é ela que recusa quando o provedor está desligado.
  let provedor = null;
  try {
    const r = await fetch(
      "https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=" +
        "AIzaSyDBvwGE-z1U684L7qglv8SnAscY0Tp6MoE",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "sonda-inexistente@surgeos.local",
          password: "sonda-sem-uso-000",
          returnSecureToken: true,
        }),
      }
    );
    const j = await r.json();
    const msg = (j.error && j.error.message) || "";
    if (msg.includes("OPERATION_NOT_ALLOWED")) provedor = false;
    else provedor = true; // EMAIL_NOT_FOUND / INVALID_LOGIN_CREDENTIALS
  } catch (e) {
    provedor = null;
  }

  console.log(
    `${provedor === null ? meio : ok(provedor)} 1. Provedor E-mail/senha: ` +
      (provedor === null ? "não deu para verificar (sem internet?)"
        : provedor ? "ATIVADO" : "DESATIVADO — ative no Console antes de migrar")
  );

  // ---- 2. Colaboradores ---------------------------------------------
  const snap = await db.collection("colaboradores").get();
  const pessoas = snap.docs.filter((d) => !d.id.startsWith("_"));
  const comUid = pessoas.filter((d) => d.data().uid);
  const comSenha = pessoas.filter((d) => d.data().senha !== undefined);

  console.log(
    `${ok(comUid.length === pessoas.length && pessoas.length > 0)} 2. Migração: ` +
      `${comUid.length}/${pessoas.length} colaboradores com conta vinculada`
  );
  for (const d of pessoas) {
    const t = d.data();
    console.log(
      `      ${t.uid ? "✔" : "·"} ${d.id.padEnd(22)} ` +
        `${t.uid ? "uid ok" : "sem uid"}` +
        `${t.senha !== undefined ? "  \x1b[31m← ainda tem campo senha\x1b[0m" : ""}` +
        `${t.precisaTrocar ? "  (troca pendente)" : ""}`
    );
  }

  console.log(
    `${ok(comSenha.length === 0)} 3. Senhas em texto puro removidas: ` +
      (comSenha.length === 0 ? "sim" : `NÃO — ${comSenha.length} ainda têm o campo`)
  );

  // ---- 4. Lista pública ----------------------------------------------
  const pub = await db.collection("publico").doc("colaboradores").get();
  const nomes = pub.exists ? pub.data().nomes || [] : [];
  console.log(
    `${ok(pub.exists && nomes.length > 0)} 4. Lista pública de nomes: ` +
      (pub.exists ? `${nomes.length} nomes` : "não existe — o seletor de login ficará vazio")
  );

  // ---- 5. admin/config antigo -----------------------------------------
  const cfg = await db.collection("admin").doc("config").get();
  console.log(
    `${ok(!cfg.exists)} 5. Documento admin/config (senha em texto): ` +
      (cfg.exists ? "AINDA EXISTE" : "removido")
  );

  // ---- 6. Administradores ----------------------------------------------
  const admins = [];
  for (const d of pessoas) {
    const uid = d.data().uid;
    if (!uid) continue;
    try {
      const u = await auth.getUser(uid);
      if (u.customClaims && u.customClaims.admin === true) admins.push(d.id);
    } catch {}
  }
  console.log(
    `${ok(admins.length > 0)} 6. Administradores: ` +
      (admins.length ? admins.join(", ") : "nenhum — rode conceder_admin.js")
  );

  // ---- Próximo passo ----------------------------------------------------
  console.log("\n" + "-".repeat(60));
  if (provedor === false) {
    console.log("  PRÓXIMO: ative E-mail/senha no Console do Firebase.");
    console.log("  Authentication → Sign-in method → Email/Password → Ativar");
  } else if (comUid.length < pessoas.length) {
    console.log("  PRÓXIMO: node migrar_para_auth.js --aplicar");
  } else if (!admins.length) {
    console.log('  PRÓXIMO: node conceder_admin.js "SEU NOME"');
  } else {
    console.log("  PRÓXIMO: publicar as regras e o app.");
    console.log("     npx firebase-tools deploy --only firestore:rules --project surgeos");
    console.log("     (e o merge da branch em main publica o app pelo GitHub Actions)");
  }
  console.log("-".repeat(60) + "\n");

  process.exit(0);
}

main().catch((e) => {
  console.error("\nErro:", e.message, "\n");
  process.exit(1);
});
