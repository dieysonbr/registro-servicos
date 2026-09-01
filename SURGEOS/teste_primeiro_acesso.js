// Teste ponta a ponta do primeiro acesso, com login real.
//
// Cria um colaborador temporário, entra com a senha provisória, confere que
// o painel NÃO abre, define a senha nova, confere que o painel abre e que
// precisaTrocar virou false. Apaga tudo no final, aconteça o que acontecer.
//
// O colaborador de teste NÃO entra na lista pública, então não aparece no
// seletor de ninguém — a opção é injetada só nesta página.

const http = require("http");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const { initializeApp, cert } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { getAuth } = require("firebase-admin/auth");
const { carregar } = require("E:/CLAUDE/UNICAMPO/registro-servicos/SURGEOS/chave.js");

const RAIZ = "E:/CLAUDE/UNICAMPO/registro-servicos/SURGEOS";
const NOME = "ZZ TESTE AUTOMATIZADO";
const EMAIL = "zz-teste-automatizado@surgeos.local";
const SENHA_TEMP = "Prov1sori4Teste";
const SENHA_NOVA = "N0vaSenhaTeste";

const { credencial } = carregar();
initializeApp({ credential: cert(credencial) });
const db = getFirestore();
const auth = getAuth();

const TIPOS = { ".html": "text/html", ".jpg": "image/jpeg" };
const srv = http.createServer((q, r) => {
  const a = path.join(RAIZ, q.url === "/" ? "index.html" : decodeURIComponent(q.url.split("?")[0]));
  fs.readFile(a, (e, d) => {
    if (e) { r.writeHead(404); return r.end(); }
    r.writeHead(200, { "Content-Type": TIPOS[path.extname(a)] || "application/octet-stream" });
    r.end(d);
  });
});

const passos = [];
const reg = (nome, ok, extra) => {
  passos.push({ nome, ok, extra });
  console.log(`  ${ok ? "\x1b[32m✔\x1b[0m" : "\x1b[31m✖\x1b[0m"} ${nome}${extra ? "  — " + extra : ""}`);
};

async function limpar(uid) {
  try { if (uid) await auth.deleteUser(uid); } catch {}
  try { await db.collection("colaboradores").doc(NOME).delete(); } catch {}
}

(async () => {
  let uid = null;
  let nav = null;

  try {
    // Se sobrou de uma execução anterior, limpa antes.
    try { const u = await auth.getUserByEmail(EMAIL); await auth.deleteUser(u.uid); } catch {}
    await db.collection("colaboradores").doc(NOME).delete().catch(() => {});

    const u = await auth.createUser({ email: EMAIL, password: SENHA_TEMP, displayName: NOME });
    uid = u.uid;
    await db.collection("colaboradores").doc(NOME).set({ uid, precisaTrocar: true, criadoEm: Date.now() });

    console.log("\n=== FLUXO DE PRIMEIRO ACESSO ===\n");

    await new Promise((r) => srv.listen(4176, r));
    nav = await chromium.launch();
    const p = await nav.newPage({ viewport: { width: 1280, height: 900 } });
    const alertas = [];
    p.on("dialog", (d) => { alertas.push(d.message().slice(0, 90)); d.dismiss(); });
    const erros = [];
    p.on("pageerror", (e) => erros.push(e.message));

    await p.goto("http://localhost:4176/", { waitUntil: "domcontentloaded" });
    await p.waitForTimeout(5000);

    // O nome de teste não está na lista pública; injetamos a opção.
    await p.evaluate((n) => {
      const s = document.getElementById("selectColaboradorLogin");
      const o = document.createElement("option");
      o.value = n; o.innerText = n; s.appendChild(o);
    }, NOME);

    await p.selectOption("#selectColaboradorLogin", NOME);
    await p.fill("#inputSenhaLogin", SENHA_TEMP);
    await p.click("#btnSubmitLogin");
    await p.waitForTimeout(5000);

    const depoisDoLogin = await p.evaluate(() => ({
      painelAberto: !document.getElementById("painelPrincipalSistema").classList.contains("hidden"),
      blocoTroca: !document.getElementById("divGrupoNovaSenha").classList.contains("hidden"),
      rotulo: document.getElementById("btnSubmitLogin").innerText.trim(),
    }));

    reg("painel NÃO abre com senha provisória", depoisDoLogin.painelAberto === false,
        depoisDoLogin.painelAberto ? "abriu — rotação não é forçada" : "");
    reg("bloco de troca aparece", depoisDoLogin.blocoTroca === true);
    reg("botão vira 'Definir nova senha'", depoisDoLogin.rotulo === "Definir nova senha", depoisDoLogin.rotulo);

    // Segunda etapa: define a senha nova.
    await p.fill("#inputNovaSenhaCadastro", SENHA_NOVA);
    await p.click("#btnSubmitLogin");
    await p.waitForTimeout(6000);

    const depoisDaTroca = await p.evaluate(() => ({
      painelAberto: !document.getElementById("painelPrincipalSistema").classList.contains("hidden"),
      blocoTroca: !document.getElementById("divGrupoNovaSenha").classList.contains("hidden"),
    }));

    reg("painel abre depois de definir a senha", depoisDaTroca.painelAberto === true);
    reg("bloco de troca some", depoisDaTroca.blocoTroca === false);

    const doc = await db.collection("colaboradores").doc(NOME).get();
    reg("precisaTrocar virou false no Firestore", doc.data().precisaTrocar === false);

    // A senha nova realmente vale?
    const r = await fetch(
      "https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=AIzaSyDBvwGE-z1U684L7qglv8SnAscY0Tp6MoE",
      { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: EMAIL, password: SENHA_NOVA, returnSecureToken: true }) }
    );
    reg("senha nova autentica no Firebase Auth", r.status === 200);

    const r2 = await fetch(
      "https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=AIzaSyDBvwGE-z1U684L7qglv8SnAscY0Tp6MoE",
      { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: EMAIL, password: SENHA_TEMP, returnSecureToken: true }) }
    );
    reg("senha provisória deixou de valer", r2.status !== 200);

    console.log("\n  alertas exibidos: " + (alertas.length ? alertas.join(" | ") : "nenhum"));
    console.log("  erros de JS: " + (erros.length ? erros.join(" | ") : "nenhum"));

    const falhas = passos.filter((x) => !x.ok).length;
    console.log("\n" + (falhas ? `\x1b[31m${falhas} PASSO(S) FALHARAM\x1b[0m` : "\x1b[32mTODOS OS PASSOS PASSARAM\x1b[0m") + "\n");
  } catch (e) {
    console.error("\nErro no teste:", e.message);
  } finally {
    if (nav) await nav.close();
    srv.close();
    await limpar(uid);
    const sobrou = await db.collection("colaboradores").doc(NOME).get();
    console.log("limpeza: colaborador de teste " + (sobrou.exists ? "\x1b[31mNÃO removido\x1b[0m" : "removido"));
    process.exit(0);
  }
})();
