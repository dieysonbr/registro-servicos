# Trabalhar neste projeto de outra máquina

O repositório sozinho **não basta** para rodar os scripts administrativos.
Duas coisas ficam de fora do git de propósito, e este documento existe para
você não descobrir isso no meio de uma urgência.

---

## O que o git traz

Tudo o que o site precisa para funcionar: `SURGEOS/index.html`,
`manutencao.html`, `img/`, as regras (`firestore.rules`) e os scripts.

## O que o git NÃO traz

| Arquivo | Por quê | Como obter de novo |
|---|---|---|
| `surgeos-firebase-admin.json` | Credencial do Admin SDK. Ignora todas as regras de segurança — quem a tem é dono do banco. | Console do Firebase → Configurações do projeto → Contas de serviço → Gerar nova chave privada |
| `SURGEOS/node_modules/` | 5.616 arquivos que o npm reconstrói | `npm install` |
| `senhas_temporarias.txt` | Senhas em texto. Descartável após distribuir. | Regerado pela migração, se preciso |
| `backup_pre_auth_*.json` | Dump com dados dos técnicos | Guarde fora do git, num lugar seu |

**A chave nunca vai para o GitHub.** Não a mande por e-mail nem WhatsApp;
gerar uma nova leva trinta segundos e invalida a anterior.

---

## Preparar uma máquina nova

```bash
git clone https://github.com/dieysonbr/registro-servicos.git
cd registro-servicos/SURGEOS
npm install
```

Depois gere a chave no Console e salve **fora da pasta do repositório**:

```
<qualquer pasta>/surgeos-firebase-admin.json
```

O `chave.js` procura nesta ordem:

1. a variável de ambiente `SURGEOS_SERVICE_ACCOUNT`
2. `../../surgeos-firebase-admin.json` (uma pasta acima do repositório)
3. `../surgeos-firebase-admin.json`
4. `SURGEOS/serviceAccountKey.json` (dentro do repo — funciona, mas é o pior lugar)

Se preferir apontar explicitamente:

```bash
set SURGEOS_SERVICE_ACCOUNT=C:\caminho\para\a\chave.json
```

Confirme que está tudo no lugar:

```bash
node verificar_estado.js
```

Ele lê e não altera nada. Se a chave for encontrada e o projeto for
`surgeos`, você está pronto.

---

## O ciclo de trabalho

O histórico antigo deste repositório é de commits "Add files via upload" —
arquivos enviados pela interface web do GitHub. Isso funciona para um
arquivo, mas não sobrevive a duas máquinas: não há histórico útil, não há
como voltar atrás, e a segunda máquina sobrescreve a primeira em silêncio.

O ciclo abaixo resolve isso.

### Antes de começar a mexer

```bash
git pull
```

Traz o que foi feito na outra máquina. **Pular este passo é a causa número
um de conflito.**

### Enquanto trabalha

```bash
git status
git add .
git commit -m "descrição do que mudou"
```

Commits pequenos e frequentes. Um commit que muda uma coisa é fácil de
reverter; um que muda quinze, não.

### Ao terminar

```bash
git push
```

---

## Publicar no ar

São dois destinos independentes, e o GitHub cuida de só um deles.

**O site** sobe sozinho quando algo entra na branch `main`, pelo
GitHub Actions (`.github/workflows/firebase-hosting-merge.yml`).

**As regras do Firestore não sobem por ali.** O workflow publica apenas o
hosting. Regras é sempre comando local:

```bash
npx firebase-tools deploy --only firestore:rules --project surgeos
```

Esquecer isso significa app novo rodando contra regras velhas — que foi
como o sistema saiu do ar em 01/09/2026.

---

## Trabalhar em branch, não direto na main

Qualquer push para `main` publica no ar imediatamente. Para mudanças que
não são triviais:

```bash
git checkout -b nome-da-mudanca
# ... trabalha, commita ...
git push -u origin nome-da-mudanca
```

Abrir um Pull Request no GitHub gera um canal de preview com URL própria.

**Atenção a uma limitação real:** o canal de preview isola apenas o
*hosting*. Firestore, Authentication e regras são os mesmos do projeto,
compartilhados entre todos os canais. O preview testa aparência e
JavaScript — não testa mudança de regra nem de dados.

---

## Testes

```bash
cd SURGEOS
NODE_PATH=./node_modules node teste_primeiro_acesso.js
```

Precisa do `playwright` instalado (`npm i -D playwright && npx playwright install chromium`).

Ele cria um colaborador temporário, exercita o primeiro acesso inteiro com
login real e apaga tudo no final. Roda contra o banco de produção, então o
colaborador aparece por alguns segundos — pelo nome `ZZ TESTE AUTOMATIZADO`,
e fora da lista pública, então ninguém o vê no seletor.

---

## Se algo der errado

```bash
git log --oneline -10          # onde estamos
git diff                       # o que mudou e não foi commitado
git checkout -- <arquivo>      # descarta mudança não commitada
git revert <hash>              # desfaz um commit já publicado
```

Para o banco, o ponto de retorno é o `backup_pre_auth_*.json` gerado pela
migração. Guarde-o fora do repositório.
