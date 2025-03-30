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
  const { question } = req.body;
  const key = normalize(question);

  if (!question) return res.status(400).json({ reply: 'Вопрос не передан' });

  if (cache.has(key)) {
    console.log('Ответ из кеша');
    return res.json({ reply: cache.get(key) });
  }

  try {
    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-3.5-turbo',
        messages: [
          {
            role: 'system',
            content:
              'Ты чат-бот, который помогает изучать глаголы иврита. Отвечай на языке вопроса. Используй Markdown: **жирный** для важных частей, _курсив_ для слов на иврите.',
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

    const reply = response.data.choices[0].message.content;
    cache.set(key, reply);
    res.json({ reply });
  } catch (error) {
    console.error('Ошибка запроса:', error.response?.data || error.message);
    res.status(500).json({ reply: 'Ошибка при запросе к ChatGPT' });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Сервер работает: http://localhost:${PORT}`);
});
