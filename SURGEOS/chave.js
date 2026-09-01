// chave.js
//
// Localiza a credencial do Admin SDK para os scripts locais.
//
// A chave ignora TODAS as regras de segurança do Firestore — quem a tem é
// dono do banco. Por isso a ordem de busca prefere caminhos FORA do
// repositório: um arquivo que nunca entra na árvore do git não pode ser
// commitado por engano, nem por um `git add -A` distraído.

const fs = require("fs");
const path = require("path");

const RAIZ = __dirname;

// Em ordem de preferência.
const CANDIDATOS = [
  process.env.SURGEOS_SERVICE_ACCOUNT,
  path.join(RAIZ, "..", "..", "surgeos-firebase-admin.json"),
  path.join(RAIZ, "..", "surgeos-firebase-admin.json"),
  path.join(RAIZ, "serviceAccountKey.json"),
].filter(Boolean);

function localizar() {
  for (const c of CANDIDATOS) {
    if (fs.existsSync(c)) return path.resolve(c);
  }
  return null;
}

function carregar() {
  const caminho = localizar();

  if (!caminho) {
    console.error("\n✖ Credencial do Admin SDK não encontrada.\n");
    console.error("  Procurei em:");
    for (const c of CANDIDATOS) console.error("    - " + path.resolve(c));
    console.error("\n  Gere em: Console do Firebase -> Configurações do projeto");
    console.error("           -> Contas de serviço -> Gerar nova chave privada\n");
    console.error("  Ou aponte explicitamente:");
    console.error("    set SURGEOS_SERVICE_ACCOUNT=C:\\caminho\\para\\chave.json\n");
    process.exit(1);
  }

  const dados = require(caminho);

  // Um script apontado para o projeto errado escreveria em produção alheia.
  if (dados.project_id !== "surgeos") {
    console.error(`\n✖ A chave é do projeto "${dados.project_id}", esperado "surgeos".`);
    console.error("  " + caminho + "\n");
    process.exit(1);
  }

  // Avisa se a chave estiver dentro da árvore versionada.
  const dentroDoRepo = !path.relative(path.join(RAIZ, ".."), caminho).startsWith("..");
  if (dentroDoRepo) {
    console.warn("\n⚠ A chave está dentro do repositório: " + caminho);
    console.warn("  O .gitignore cobre serviceAccountKey.json, mas guardá-la");
    console.warn("  fora da árvore do git é mais seguro.\n");
  }

  return { credencial: dados, caminho };
}

module.exports = { carregar, localizar };
