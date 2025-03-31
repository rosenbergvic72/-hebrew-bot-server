const express = require('express');
const axios = require('axios');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const cache = new Map();
const model = 'gpt-4o-mini';

function normalize(text) {
  return text.trim().toLowerCase();
}

app.post('/ask', async (req, res) => {
  console.log('📥 Получен запрос от клиента:', req.body);

  const { question, history = [] } = req.body;

  if (!question) {
    console.warn('⚠️ Вопрос не передан!');
    return res.status(400).json({ reply: 'Вопрос не передан' });
  }

  const key = normalize(question);

  if (cache.has(key)) {
    console.log('💾 Ответ из кеша');
    return res.json({ reply: cache.get(key) });
  }

  try {
    console.log('🔗 Отправка запроса в OpenAI...');
    console.log('📦 Используем модель:', model);

    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model,
        messages: [
          {
            role: 'system',
            content: `
            Ты — умный и дружелюбный чат-бот, который помогает изучать глаголы и грамматику иврита: времена, биньяны, формы, спряжения, императивы, перевод, структура.
            
            🔤 Всегда отвечай на языке, на котором был задан последний вопрос. Это правило приоритетнее всего. Не используй другие языки без явной просьбы пользователя.
            
            Примеры:
            - Вопрос на русском → ответ на русском
            - Вопрос на английском → ответ на английском
            - Вопрос на французском → ответ на французском
            - Вопрос на испанском → ответ на испанском
            - Вопрос на португальском → ответ на португальском
            - Вопрос на арабском → ответ на арабском
            - Вопрос на амхарском → ответ на амхарском
            
            Никогда не проси пользователя писать на иврите. Пользователь может спрашивать на любом языке — ты обязан отвечать на том же языке.
            
            📚 Ты специализируешься на:
            - Глаголах иврита: времена, биньяны, спряжения, формы, структура
            - Переводах, примерах, пояснениях
            - Таблицах спряжений по запросу
            
            ❗ Не отвечай на вопросы, не связанные с ивритом. Вежливо откажись и сообщи, что ты бот по ивритским глаголам.
            
            📌 Не используй HTML — только **чистый Markdown**.
            
            🧩 Структурируй ответы:
            - Заголовки, списки, подчёркнутый и **жирный текст**
            - Примеры с пояснением
            - Чёткие, аккуратные таблицы
            - Краткие, понятные и полезные объяснения
            `
            
          },
          ...history,
          { role: 'user', content: question },
        ],
        temperature: 0.7,
      },
      {
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
      }
    );

    const reply = response.data.choices?.[0]?.message?.content;

    if (!reply) {
      console.warn('⚠️ OpenAI вернул пустой ответ!');
      return res.status(500).json({ reply: 'Пустой ответ от ChatGPT' });
    }

    cache.set(key, reply);
    console.log('✅ Ответ получен от OpenAI');
    res.json({ reply });
  } catch (error) {
    console.error('❌ Ошибка запроса к OpenAI:', error.response?.data || error.message);
    res.status(500).json({ reply: 'Ошибка при запросе к ChatGPT' });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 Сервер работает: http://localhost:${PORT}`);
});
