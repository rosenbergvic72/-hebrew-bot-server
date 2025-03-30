const express = require('express');
const axios = require('axios');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const cache = new Map();

function normalize(text) {
  return text.trim().toLowerCase();
}

app.post('/ask', async (req, res) => {
  console.log('📥 Получен запрос от клиента:', req.body); // Лог всего тела запроса

  const { question } = req.body;

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
    const model = 'gpt-4o-mini';
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
Ты — чат-бот, который помогает изучать глаголы и грамматику иврита.

✅ Отвечай только по теме глаголов иврита: времена, биньяны, спряжения, формы, перевод, структура.

🚫 Если вопрос не относится к ивриту — ответь вежливо, что ты можешь только по ивритским глаголам.

✅ Используй разметку:
- [HE] ивритские слова [/HE]
- [TR] транслитерация на латинице [/TR]
- [BINYAN] названия биньянов [/BINYAN]
- Markdown: **жирный** для важного, _курсив_ для примеров.

✅ В таблицах спряжения добавляй:
- [HE] слово на иврите
- [TR] транслитерацию
- Перевод (на языке вопроса)

📌 Не используй HTML или <span> — только Markdown и указанные теги.
📌 Ответ начинай с новой строки. Структурируй его для удобства восприятия.
            `
          },
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
