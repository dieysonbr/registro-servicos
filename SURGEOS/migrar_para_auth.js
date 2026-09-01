// migrar_para_auth.js
//
// Move a autenticação do SurgeOS de "senha em texto puro no Firestore" para
// o Firebase Auth (e-mail/senha).
//
// Contexto: até esta migração, a coleção `colaboradores` guardava o campo
// `senha` em texto puro, e as regras liberavam a leitura para qualquer sessão
// autenticada — inclusive a sessão anônima que o próprio site criava ao
// carregar. Na prática, qualquer visitante conseguia ler todas as senhas.
//
// Por isso as senhas atuais NÃO são preservadas: elas estão comprometidas.
// Cada colaborador recebe uma senha temporária aleatória e é obrigado a
// trocá-la no primeiro acesso (o app já tem esse fluxo, via `precisaTrocar`).
//
// Como rodar:
//   node migrar_para_auth.js              # simulação, não escreve nada
//   node migrar_para_auth.js --aplicar    # executa de verdade
//
// Requisitos:
//   - serviceAccountKey.json nesta pasta
//   - provedor "E-mail/senha" habilitado no Console do Firebase
//     (Authentication -> Sign-in method -> Email/Password -> Ativar)

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const { initializeApp, cert } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { getAuth } = require("firebase-admin/auth");

const APLICAR = process.argv.includes("--aplicar");
const DOMINIO = "surgeos.local";

const { carregar } = require("./chave");

const { credencial, caminho: caminhoChave } = carregar();
initializeApp({ credential: cert(credencial) });
const db = getFirestore();
const auth = getAuth();

// Deriva um e-mail estável a partir do nome. O documento continua indexado
// pelo nome (é assim que os serviços referenciam o colaborador), então o
// e-mail precisa ser uma função determinística dele.
function emailDe(nome) {
  const slug = nome
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${slug}@${DOMINIO}`;
}

// O Firebase Auth exige no mínimo 6 caracteres; várias senhas atuais têm 3
// (o app aceitava). Geramos 10 para não depender do que existe hoje.
function senhaTemporaria() {
  const alfabeto = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789abcdefghijkmnpqrstuvwxyz";
  return Array.from(crypto.randomBytes(10))
    .map((b) => alfabeto[b % alfabeto.length])
    .join("");
}

async function backup() {
  const carimbo = new Date().toISOString().replace(/[:.]/g, "-");
  const destino = path.join(__dirname, `backup_pre_auth_${carimbo}.json`);

  const dump = {};
  for (const nome of ["colaboradores", "servicos", "admin"]) {
    const snap = await db.collection(nome).get();
    dump[nome] = snap.docs.map((d) => ({ id: d.id, dados: d.data() }));
  }

  fs.writeFileSync(destino, JSON.stringify(dump, null, 2), "utf8");
  console.log(`  backup: ${path.basename(destino)}`);
  console.log(
    `          ${dump.colaboradores.length} colaboradores, ` +
      `${dump.servicos.length} serviços, ${dump.admin.length} docs de admin\n`
  );
  return destino;
}

async function main() {
  console.log("\n" + "=".repeat(64));
  console.log(APLICAR ? "  MIGRAÇÃO — MODO REAL" : "  MIGRAÇÃO — SIMULAÇÃO (nada será escrito)");
  console.log("=".repeat(64) + "\n");

  if (APLICAR) {
    console.log("Gerando backup antes de tocar em qualquer coisa...");
    await backup();
  }

  const snap = await db.collection("colaboradores").get();
  if (snap.empty) {
    console.log("Nenhum colaborador encontrado. Nada a fazer.\n");
    process.exit(0);
  }

  const credenciais = [];
  const nomes = [];
  const ignorados = [];
  let criados = 0;
  let reaproveitados = 0;
  const falhas = [];

  // Nem todo documento em `colaboradores` é pessoa. O banco tem um
  // `_SISTEMA_SEED_INICIAL_`, registro de sistema; sem esta trava a migração
  // criaria uma conta de autenticação real para ele, com senha temporária,
  // e o nome apareceria no seletor de login.
  const ehRegistroDeSistema = (id) => id.startsWith("_") || id.startsWith(".");

  for (const docSnap of snap.docs) {
    const nome = docSnap.id;

    if (ehRegistroDeSistema(nome)) {
      ignorados.push(nome);
      console.log(`  – ${nome} (registro de sistema, ignorado)`);
      continue;
    }

    const dados = docSnap.data();
    const email = emailDe(nome);
    const senha = senhaTemporaria();

    nomes.push(nome);

    if (!APLICAR) {
      console.log(`  ${nome}`);
      console.log(`    email ....... ${email}`);
      console.log(`    senha ....... (aleatória, gerada na execução real)`);
      console.log(`    campo senha . ${dados.senha !== undefined ? "será removido" : "já ausente"}`);
      continue;
    }

    try {
      let usuario;
      try {
        // Re-execução: o usuário já existe, então só redefinimos a senha.
        usuario = await auth.getUserByEmail(email);
        await auth.updateUser(usuario.uid, { password: senha });
        reaproveitados++;
      } catch (e) {
        if (e.code !== "auth/user-not-found") throw e;
        usuario = await auth.createUser({
          email,
          password: senha,
          displayName: nome,
        });
        criados++;
      }

      await docSnap.ref.update({
        uid: usuario.uid,
        precisaTrocar: true,
        senha: FieldValue.delete(),
      });

      credenciais.push({ nome, email, senha });
      console.log(`  ✔ ${nome} -> ${usuario.uid}`);
    } catch (e) {
      falhas.push({ nome, erro: e.message });
      console.log(`  ✖ ${nome}: ${e.message}`);
    }
  }

  // Lista pública de nomes: a tela de login precisa preencher o seletor antes
  // de existir qualquer sessão, e a coleção `colaboradores` agora exige
  // autenticação. Só nomes entram aqui.
  if (APLICAR) {
    await db.collection("publico").doc("colaboradores").set({
      nomes: nomes.sort((a, b) => a.localeCompare(b, "pt-BR")),
      atualizadoEm: Date.now(),
    });

    // O documento admin/config guardava a senha do administrador em texto e
    // era legível por qualquer sessão. A permissão agora é custom claim.
    const cfg = db.collection("admin").doc("config");
    if ((await cfg.get()).exists) {
      await cfg.delete();
      console.log("\n  admin/config removido (a senha em texto deixou de existir)");
    }

    const arquivo = path.join(__dirname, "senhas_temporarias.txt");
    const linhas = credenciais.map((c) => `${c.nome}\t${c.senha}`).join("\n");
    fs.writeFileSync(
      arquivo,
      "Senhas temporárias do SurgeOS\n" +
        "Cada colaborador troca a senha no primeiro acesso.\n" +
        "APAGUE ESTE ARQUIVO depois de distribuir.\n\n" +
        linhas +
        "\n",
      "utf8"
    );
    console.log(`  senhas temporárias: senhas_temporarias.txt`);
  }

  console.log("\n" + "-".repeat(64));
  if (APLICAR) {
    console.log(`  criados: ${criados}   redefinidos: ${reaproveitados}   falhas: ${falhas.length}`);
    console.log("\n  Próximos passos:");
    console.log("   1. Distribua as senhas de senhas_temporarias.txt para cada técnico");
    console.log("   2. Apague o arquivo depois");
    console.log("   3. Rode: node conceder_admin.js  (para se tornar administrador)");
    console.log("   4. Publique: firebase deploy --only firestore:rules,hosting");
  } else {
    console.log(`  ${nomes.length} colaboradores seriam migrados.`);
    if (ignorados.length) {
      console.log(`  ${ignorados.length} ignorados: ${ignorados.join(", ")}`);
    }
    console.log("  Nada foi escrito. Para executar de verdade:");
    console.log("     node migrar_para_auth.js --aplicar");
  }
  console.log("-".repeat(64) + "\n");

  process.exit(falhas.length ? 1 : 0);
}

main().catch((e) => {
  console.error("\nErro fatal:", e);
  process.exit(1);
});
