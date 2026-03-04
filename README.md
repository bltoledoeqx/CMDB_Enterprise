# CMDB Enterprise — Docker + Agente Local

## Estrutura

```
cmdb-docker/
├── Dockerfile
├── docker-compose.yml
├── server/
│   ├── server.js          ← API Express
│   └── package.json
├── public/
│   ├── cmdb.html          ← App web
│   └── cmdbAPI.js         ← Shim fetch (substitui IPC do Electron)
└── agent/
    ├── agent.js           ← Agente local Windows (RDP/SSH)
    ├── package.json
    ├── install.bat        ← Instala como serviço de inicialização
    └── uninstall.bat
```

---

## 1. Servidor Docker

### Subir

```bash
docker-compose up -d
```

O app fica disponível em `http://SEU-SERVIDOR:3000`

### Configurações importantes em docker-compose.yml

```yaml
environment:
  - SESSION_SECRET=mude-esta-chave-em-producao-2024   # ← troque isso
ports:
  - "3000:3000"   # troque a porta externa se necessário
```

### Dados persistentes

Os dados ficam no volume Docker `cmdb-data`.  
Para fazer backup:

```bash
docker run --rm -v cmdb-data:/data -v $(pwd):/backup \
  alpine tar czf /backup/cmdb-backup.tar.gz /data
```

Para restaurar:

```bash
docker run --rm -v cmdb-data:/data -v $(pwd):/backup \
  alpine tar xzf /backup/cmdb-backup.tar.gz -C /
```

---

## 2. Agente Local Windows

O agente roda em **cada máquina Windows** dos usuários.  
Ele escuta em `localhost:27420` e executa RDP/SSH localmente quando o browser pede.

### Instalação (uma vez por máquina)

1. Copie a pasta `agent/` para a máquina Windows
2. Execute `install.bat` **como Administrador**
3. O agente inicia automaticamente com o Windows

### O que o agente faz

| Chamada do browser | Ação local |
|---|---|
| `POST localhost:27420/rdp` | Injeta credenciais via `cmdkey` e abre `mstsc.exe` |
| `POST localhost:27420/ssh` | Abre terminal com `ssh` nativo (ou jump host) |

### Verificar se está rodando

Abra no browser: `http://localhost:27420/health`  
Deve retornar: `{"ok":true,"version":"2.0"}`

### Desinstalar

Execute `uninstall.bat` como Administrador.

---

## 3. Primeiro acesso

1. Acesse `http://SEU-SERVIDOR:3000`
2. Crie o primeiro usuário (admin) no formulário que aparecer
3. Faça login

---

## 4. Proxy reverso (opcional)

Para servir via HTTPS com nginx:

```nginx
server {
    listen 443 ssl;
    server_name cmdb.sua-empresa.com;

    ssl_certificate     /etc/ssl/cmdb.crt;
    ssl_certificate_key /etc/ssl/cmdb.key;

    location / {
        proxy_pass         http://localhost:3000;
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
    }
}
```
