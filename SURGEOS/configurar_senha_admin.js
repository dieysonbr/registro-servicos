// configurar_senha_admin.js
//
// Define (ou troca) a senha de administrador do painel diretamente no
// Firestore, usando o Admin SDK. Isso é necessário porque, com as novas
// Regras de Segurança, o navegador NÃO tem mais permissão para escrever
// no documento admin/config — só o Admin SDK (rodando localmente, com a
// serviceAccountKey.json) consegue.
//
// Rode este script sempre que quiser definir a senha pela primeira vez
// ou trocá-la depois.
//
// Como rodar:
//   node configurar_senha_admin.js

const { initializeApp, cert } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const readline = require("readline");
const serviceAccount = require("./serviceAccountKey.json");

initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

function perguntar(pergunta) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(pergunta, (resposta) => { rl.close(); resolve(resposta); }));
}

async function main() {
  const senha = await perguntar("Digite a nova senha de administrador: ");

  if (!senha || senha.trim().length < 4) {
    console.log("A senha deve ter pelo menos 4 caracteres. Nada foi alterado.");
    process.exit(1);
  }

  await db.collection("admin").doc("config").set({ senha: senha.trim() });
  console.log("\n✔ Senha de administrador configurada com sucesso!");
  process.exit(0);
}

main().catch((err) => {
  console.error("Erro:", err);
  process.exit(1);
});
