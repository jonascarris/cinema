# 🎬 Sistema de Venda de Ingressos de Cinema - Daniel e a Fornalha Ardente

Site moderno, responsivo e de alta conversão para venda de ingressos com integração direta ao **Mercado Pago** e banco de dados **Supabase** (herdando toda a arquitetura e tokens do projeto `praCamilaMiguel`).

---

## 📌 Informações da Sessão

- **Filme:** Daniel e a Fornalha Ardente
- **Data & Horário:** 02/11 às 19h00
- **Chegada Recomendada:** Às **18h30** (30 minutos de antecedência para retirada de pipoca e acomodação)
- **Local:** Cinesystem - Américas Shopping
- **Endereço:** Av. das Américas, 15.500 - Recreio dos Bandeirantes, Rio de Janeiro - RJ (CEP: 22790-702)
- **Valor do Ingresso:** R$ 27,00
- **Regra para Crianças:** Crianças de até 3 anos **não pagam** (no colo). Acima de 3 anos pagam valor integral (R$ 27,00).
- **Trailer Oficial:** [YouTube](https://www.youtube.com/watch?v=Ts2EyTfNyZk)

---

## 🌐 Estrutura de Hospedagem e Domínio (Como Replicar)

O projeto segue a mesma arquitetura moderna e escalável do `praCamilaMiguel`:

### 1. Hospedagem Serverless (Recomendada: Vercel)
- **Frontend Estático:** Os arquivos `index.html`, `ingresso.html`, `admin.html`, `css/` e `js/` são servidos pela CDN global da Vercel com velocidade instantânea.
- **Backend API:** O arquivo `api/index.js` roda como **Vercel Serverless Function** através do `vercel.json`.
- **Certificado SSL:** HTTPS emitido e renovado automaticamente de forma 100% gratuita.

#### Passo a Passo para Deploy na Vercel:
1. Instale o CLI da Vercel ou conecte via GitHub:
   ```bash
   npx vercel
   ```
2. Configure as variáveis de ambiente no painel da Vercel (copiando do arquivo `.env`):
   - `MERCADO_PAGO_ACCESS_TOKEN`
   - `MERCADO_PAGO_PUBLIC_KEY`
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `ADMIN_PASSWORD`

### 2. Configuração de Domínio / Subdomínio
Para apontar seu domínio (ex: `ingresso.carrisconsultoria.com` ou `cinemadaniel.com.br`):
- **Se for Subdomínio:** Adicione um registro `CNAME` na sua zona DNS (HostGator, Cloudflare ou Registro.br) apontando para:
  ```
  cname.vercel-dns.com
  ```
- **Se for Domínio Raiz:** Adicione um registro `A` apontando para o IP da Vercel:
  ```
  76.76.21.21
  ```
- No painel da Vercel: Acesse **Settings > Domains** e adicione o domínio.

---

## 🚀 Como Executar Localmente

1. Entre na pasta do projeto:
   ```bash
   cd SITES/filme-cinema
   ```
2. Instale as dependências:
   ```bash
   npm install
   ```
3. Inicie o servidor:
   ```bash
   npm start
   ```
4. Acesse no navegador:
   - **Site do Cinema:** `http://localhost:5000`
   - **Painel da Portaria / Check-in:** `http://localhost:5000/admin.html` (Senha padrão: `laranjachurrasco`)
   - **Ingresso Digital:** `http://localhost:5000/ingresso.html`

---

## 🎟️ Funcionalidades Inclusas

- [x] Pôster oficial e trailer do YouTube incorporado
- [x] Contador de ingressos pagantes com cálculo dinâmico (R$ 27,00 cada)
- [x] Contador de crianças até 3 anos (isentas de pagamento)
- [x] Alerta em destaque de chegada com 30 minutos de antecedência
- [x] Checkout transparente Mercado Pago (Pix instantâneo e Cartão de Crédito)
- [x] Emissão de Ingresso Digital com QR Code de autenticação
- [x] Botão para Imprimir / Salvar em PDF e Compartilhar via WhatsApp
- [x] Painel da portaria do cinema para conferência de lista e check-in da entrada
