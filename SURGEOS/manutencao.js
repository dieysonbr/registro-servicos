// manutencao.js
//
// Liga e desliga a página de manutenção, adicionando ou removendo um rewrite
// no firebase.json. Todo caminho passa a servir manutencao.html enquanto
// estiver ligado.
//
// Este script NÃO publica nada. Ele edita o arquivo e mostra o comando —
// apertar o botão do deploy continua sendo decisão sua.
//
//   node manutencao.js ligar
//   node manutencao.js desligar
//   node manutencao.js status

const fs = require("fs");
const path = require("path");

const ARQ = path.join(__dirname, "firebase.json");
const DESTINO = "/manutencao.html";
const REWRITE = { source: "**", destination: DESTINO };

const acao = (process.argv[2] || "status").toLowerCase();

if (!fs.existsSync(ARQ)) {
  console.error("\n✖ firebase.json não encontrado em " + __dirname + "\n");
  process.exit(1);
}

const config = JSON.parse(fs.readFileSync(ARQ, "utf8"));
if (!config.hosting) {
  console.error("\n✖ firebase.json não tem a seção 'hosting'.\n");
  process.exit(1);
}

const ligado = (config.hosting.rewrites || []).some((r) => r.destination === DESTINO);

function salvar() {
  // Mantém a indentação de 2 espaços do arquivo original e a quebra final,
  // para o diff mostrar só o que mudou de verdade.
  fs.writeFileSync(ARQ, JSON.stringify(config, null, 2) + "\n", "utf8");
}

function comando() {
  console.log("\n  Para aplicar:");
  console.log("     npx firebase-tools deploy --only hosting --project surgeos\n");
}

if (acao === "status") {
  console.log("\n  Página de manutenção: " + (ligado ? "LIGADA" : "desligada"));
  if (ligado) {
    console.log("  Todo o site está servindo manutencao.html.");
    console.log("\n  Para voltar ao normal:  node manutencao.js desligar\n");
  } else {
    console.log("\n  Para ligar:  node manutencao.js ligar\n");
  }
  process.exit(0);
}

if (acao === "ligar") {
  if (ligado) {
    console.log("\n  Já estava ligada. Nada a fazer.\n");
    process.exit(0);
  }
  if (!fs.existsSync(path.join(__dirname, "manutencao.html"))) {
    console.error("\n✖ manutencao.html não existe. O rewrite apontaria para o vazio.\n");
    process.exit(1);
  }
  // Na frente de qualquer rewrite existente: o primeiro que casa vence, e
  // "**" casa com tudo.
  config.hosting.rewrites = [REWRITE, ...(config.hosting.rewrites || [])];
  salvar();
  console.log("\n✔ Página de manutenção LIGADA no firebase.json");
  console.log("  Enquanto estiver assim, ninguém consegue usar o sistema.");
  comando();
  process.exit(0);
}

if (acao === "desligar") {
  if (!ligado) {
    console.log("\n  Já estava desligada. Nada a fazer.\n");
    process.exit(0);
  }
  config.hosting.rewrites = (config.hosting.rewrites || []).filter(
    (r) => r.destination !== DESTINO
  );
  // Chave vazia só polui o arquivo.
  if (!config.hosting.rewrites.length) delete config.hosting.rewrites;
  salvar();
  console.log("\n✔ Página de manutenção DESLIGADA no firebase.json");
  console.log("  O site volta a servir o index.html normalmente.");
  comando();
  process.exit(0);
}

console.error(`\n✖ Ação desconhecida: "${acao}". Use ligar, desligar ou status.\n`);
process.exit(1);
