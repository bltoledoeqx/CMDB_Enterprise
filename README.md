# CMDB Enterprise

Sistema centralizado de gerenciamento de infraestrutura com suporte a múltiplos usuários, acesso web via Docker e integração nativa com RDP e SSH.

---

## Sumário

1. [Visão Geral](#1-visão-geral)
2. [Arquitetura](#2-arquitetura)
3. [Estrutura de Arquivos](#3-estrutura-de-arquivos)
4. [Instalação do Servidor](#4-instalação-do-servidor)
5. [Primeiro Acesso](#5-primeiro-acesso)
6. [Agente Local Windows](#6-agente-local-windows)
7. [Funcionalidades](#7-funcionalidades)
8. [Gestão de Usuários](#8-gestão-de-usuários)
9. [Modelo de Dados e Privacidade](#9-modelo-de-dados-e-privacidade)
10. [Backup e Restauração](#10-backup-e-restauração)
11. [Proxy Reverso com HTTPS](#11-proxy-reverso-com-https)
12. [Variáveis de Ambiente](#12-variáveis-de-ambiente)
13. [Segurança](#13-segurança)

---

## 1. Visão Geral

O CMDB Enterprise é uma aplicação web que permite equipes de infraestrutura gerenciar inventário de servidores, snippets de comandos, notas técnicas e credenciais de acesso de forma centralizada e segura.

**Principais características:**

- Inventário de servidores com suporte a Windows (RDP), Linux (SSH) e dispositivos Web
- Conexões RDP e SSH disparadas diretamente do browser, sem VPN client adicional
- Sistema de usuários com perfis admin e usuário, dados privados por padrão
- Compartilhamento seletivo de itens, pastas e notas entre usuários
- Campos sensíveis (gateway, jump host) isolados por usuário, mesmo em itens públicos
- Interface responsiva, funciona em desktop e celular
- Sem dependências externas — todas as fontes e recursos são servidos localmente

---

## 2. Arquitetura

```
┌──────────────────────────────────────────┐
│  Servidor Linux                          │
│  ┌────────────────────────────────────┐  │
│  │  Docker Container                  │  │
│  │  Node.js + Express  :3000          │  │
│  │  /data (volume persistente)        │  │
│  └────────────────────────────────────┘  │
└──────────────────────────────────────────┘
              ↕  HTTP/HTTPS
┌──────────────────────────────────────────┐
│  Máquina Windows do Usuário              │
│                                          │
│  Chrome / Edge → acessa :3000            │
│                                          │
│  cmdb-agent.ps1  (localhost:27420)       │
│  ├─ /rdp  →  cmdkey + mstsc.exe         │
│  └─ /ssh  →  ssh nativo / Windows Term. │
└──────────────────────────────────────────┘
```

O servidor Docker é responsável apenas pela API e pelos dados. RDP e SSH são executados localmente na máquina do usuário pelo agente PowerShell, sem necessidade de instalação ou permissão de administrador.

---

## 3. Estrutura de Arquivos

```
CMDB_Enterprise/
├── Dockerfile
├── docker-compose.yml
├── setup.sh                  ← Instala tudo e sobe o container
├── README.md
├── server/
│   ├── server.js             ← API Express (auth, dados, RDP file gen)
│   └── package.json
└── public/
    ├── cmdb.html             ← Aplicação web completa
    ├── cmdbAPI.js            ← Camada de comunicação (fetch → servidor/agente)
    └── cmdb-agent.ps1        ← Agente local Windows (disponível para download)
```

### Dados (volume Docker `/data`)

```
/data/
├── cmdb_users.json           ← Contas de usuário (senhas com PBKDF2-SHA512)
├── public.json               ← Itens, snippets e notas compartilhados
├── sessions/                 ← Sessões de servidor (auto-gerenciadas)
└── users/
    ├── joao.silva.json       ← Dados privados + overlays de campos sensíveis
    └── maria.souza.json
```

---

## 4. Instalação do Servidor

### Pré-requisitos

- Linux com Docker e Docker Compose instalados
- Porta 3000 liberada no firewall (ou outra porta configurada)

### Setup em um comando

Baixe o `setup.sh` e execute no servidor:

```bash
bash setup.sh
```

O script cria toda a estrutura de pastas e arquivos, instala as dependências e sobe o container automaticamente.

### Subir / parar manualmente

```bash
# Subir
docker compose up -d

# Parar
docker compose down

# Rebuild após atualização dos arquivos
docker compose up -d --build

# Ver logs em tempo real
docker compose logs -f cmdb
```

---

## 5. Primeiro Acesso

1. Acesse `http://IP-DO-SERVIDOR:3000`
2. Na tela de login, clique em **Criar conta** — o primeiro usuário criado recebe automaticamente o perfil **Administrador**
3. Faça login com as credenciais criadas
4. Os demais usuários devem ser criados pelo admin em **Configurações → Usuários**

---

## 6. Agente Local Windows

Para que os botões de RDP e SSH abram conexões diretamente na máquina do usuário, é necessário rodar o agente local PowerShell. Ele não requer instalação, não altera o registro do Windows e não precisa de permissão de administrador.

### Download

Dentro do app, ao clicar em RDP ou SSH sem o agente rodando, um banner aparece com o link para download do `cmdb-agent.ps1`.

Também está disponível diretamente em: `http://SEU-SERVIDOR:3000/agent/cmdb-agent.ps1`

### Como rodar

1. Baixe o `cmdb-agent.ps1`
2. Clique com o botão direito → **Executar com PowerShell**
3. Minimize a janela (não feche)
4. Verifique em: `http://localhost:27420/health`

### Iniciar automaticamente com o Windows (sem admin)

Crie um atalho para o `cmdb-agent.ps1` e coloque na pasta de inicialização do usuário:

```
%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup
```

### O que o agente faz

| Chamada do browser | Ação local |
|---|---|
| `POST /rdp` | Injeta credenciais via `cmdkey`, gera `.rdp` temporário e abre `mstsc.exe` |
| `POST /ssh` | Abre Windows Terminal ou `cmd` com `ssh` nativo |
| `POST /ssh` (jump host) | Executa `ssh -t jumpUser@jump "ssh -t user@host"` |
| `GET /health` | Retorna status do agente |

As credenciais injetadas via `cmdkey` são removidas automaticamente 30 segundos após a conexão ser estabelecida.

---

## 7. Funcionalidades

### Inventário

- Cadastro de servidores Windows, Linux e dispositivos Web/HTML
- Campos: hostname, IP, usuário, senha, porta, SO, classe, IBX, domínio, tags, URL, notas
- **Gateway RDP**: host, usuário e senha do gateway de acesso remoto
- **SSH Jump Host**: host e usuário do servidor intermediário
- Campos sensíveis (gateway e jump) armazenados separadamente por usuário — nunca expostos em itens públicos de outros
- Ações por linha: RDP 📱 / SSH ⌨️ / Web 🌐 / Copiar Senha 🔑 / Editar / Remover
- Menu de contexto (botão direito): Editar, Copiar IP, Copiar Senha, RDP, SSH, Web, Remover
- Filtros por classe, tag e campo livre
- Ordenação por qualquer coluna
- Painel lateral (Vault) com detalhes do host selecionado

### Snippets

- Biblioteca de comandos e scripts reutilizáveis
- Organização por pacotes
- Suporte a sintaxe highlight
- Compartilhamento público/privado

### Notas

- Editor de texto rico com suporte a Markdown
- Organização em pastas
- Compartilhamento de pastas e notas individuais
- Cascade: compartilhar uma pasta torna todas as notas dentro dela públicas

### Dashboard

- Visão geral do inventário por classe e SO
- Contadores de itens públicos e privados
- Atividade recente

---

## 8. Gestão de Usuários

### Perfis

| Perfil | Permissões |
|---|---|
| **Admin** | Criar usuários, resetar senhas, excluir usuários, ver todos os usuários |
| **Usuário** | Alterar própria senha, gerenciar dados próprios, visualizar itens públicos |

### Criar usuário (admin)

**Configurações → Usuários → + Novo Usuário**

Informe username, senha (mínimo 4 caracteres) e perfil.

### Alterar senha

- **Admin**: Configurações → Usuários → 🔑 ao lado do usuário → informa nova senha
- **Qualquer usuário**: Configurações → Minha Conta → informa senha atual e nova senha

### Segurança de senhas

Senhas armazenadas com **PBKDF2-SHA512**, 120.000 iterações, salt aleatório de 32 bytes por usuário. Nenhuma senha é armazenada em texto plano.

---

## 9. Modelo de Dados e Privacidade

### Princípio: privado por padrão

Todos os itens criados são privados por padrão. O usuário decide explicitamente o que compartilhar.

### Compartilhar um item do inventário

No formulário de edição, altere a visibilidade para **🌐 Público**.

### Campos sensíveis em itens públicos

Mesmo quando um item é público, os campos de credenciais sensíveis são **isolados por usuário**:

- `gwuser`, `gwpass` (gateway RDP)
- `sshJumpUser`, `sshJumpPass` (jump host SSH)

Cada usuário preenche esses campos com suas próprias credenciais. Eles ficam armazenados no arquivo privado de cada um e nunca transitam pelo `public.json`.

### Estrutura de armazenamento

```
Usuário A publica um item:
  public.json     → { hostname, ip, usuario, _owner:'userA' }  ← sem campos sensíveis
  userA.json      → { privateOverlays: { id123: { gwuser:'...', gwpass:'...' } } }

Usuário B acessa o mesmo item:
  Vê:             → { hostname, ip, usuario, gwuser:'', gwpass:'' }
  Preenche e salva→ { userB.json: { privateOverlays: { id123: { gwuser:'...', gwpass:'...' } } } }
```

---

## 10. Backup e Restauração

### Backup

```bash
docker run --rm \
  -v cmdb-data:/data \
  -v $(pwd):/backup \
  alpine tar czf /backup/cmdb-backup-$(date +%Y%m%d).tar.gz /data
```

### Restauração

```bash
docker compose down

docker run --rm \
  -v cmdb-data:/data \
  -v $(pwd):/backup \
  alpine sh -c "rm -rf /data/* && tar xzf /backup/cmdb-backup-YYYYMMDD.tar.gz -C /"

docker compose up -d
```

### Backup via interface

Em **Configurações → Dados → Exportar Base Completa**, o app gera um arquivo JSON com todos os dados do usuário logado.

---

## 11. Proxy Reverso com HTTPS

### nginx

```nginx
server {
    listen 80;
    server_name cmdb.sua-empresa.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name cmdb.sua-empresa.com;

    ssl_certificate     /etc/ssl/certs/cmdb.crt;
    ssl_certificate_key /etc/ssl/private/cmdb.key;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;

    location / {
        proxy_pass             http://localhost:3000;
        proxy_set_header       Host $host;
        proxy_set_header       X-Real-IP $remote_addr;
        proxy_set_header       X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header       X-Forwarded-Proto $scheme;
        proxy_read_timeout     60s;
        proxy_connect_timeout  10s;
    }
}
```

### Ajuste no docker-compose.yml para produção com proxy

```yaml
services:
  cmdb:
    # Com proxy reverso, exponha apenas para localhost
    ports:
      - "127.0.0.1:3000:3000"
```

---

## 12. Variáveis de Ambiente

| Variável | Padrão | Descrição |
|---|---|---|
| `PORT` | `3000` | Porta em que o servidor escuta |
| `DATA_DIR` | `/data` | Diretório de dados persistentes |
| `SESSION_SECRET` | *(definido no compose)* | Chave de assinatura das sessões — **troque em produção** |

### Trocar o SESSION_SECRET

Edite o `docker-compose.yml`:

```yaml
environment:
  - SESSION_SECRET=sua-chave-longa-e-aleatoria-aqui
```

Após alterar, todos os usuários precisarão fazer login novamente.

---

## 13. Segurança

### Headers HTTP

O servidor aplica automaticamente os seguintes headers em todas as respostas:

| Header | Valor |
|---|---|
| `Content-Security-Policy` | Bloqueia recursos externos — fontes, scripts e imagens só do próprio servidor |
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `DENY` |
| `Referrer-Policy` | `no-referrer` |

A política CSP garante que o app **não faz nenhuma requisição externa** — fundamental para ambientes corporativos com proxy e firewall restritivo.

### Sessões

- Sessões com duração de 8 horas
- Armazenadas em arquivos no servidor (não em memória)
- Cookie `httpOnly` — inacessível via JavaScript

### Agente local

- Escuta apenas em `127.0.0.1:27420` — não acessível pela rede
- Credenciais RDP injetadas via `cmdkey` e removidas automaticamente após 30 segundos
- Arquivos `.rdp` temporários removidos após a abertura da conexão
- Não requer instalação, não altera registro do Windows, não precisa de admin
