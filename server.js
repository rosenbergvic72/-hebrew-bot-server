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
    console.log('🔗 Отправка запроса в OpenAI...');
    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-3.5-turbo',
        messages: [
          {
            role: 'system',
            content: `
          Ты чат-бот, который помогает изучать глаголы и грамматику иврита, включая биньяны.

Отвечай только по теме ивритских глаголов: их формы, времена, биньяны, спряжения, перевод, правила и структура.

Если вопрос вообще не по теме иврита — вежливо откажись.

Используй Markdown, и разметку:
- [HE] для слов на иврите
- [TR] для транслитерации
- [BINYAN] для названий биньянов 

            
          
          4. Не используй HTML или <span>
          6. Ответ начинай с новой строки
          7. В таблицы спряжения добавляй перевод и транслитерацию на латинице
         
          
          🎉 При первом запуске, на выбранном языке приложения пиши:  
          "Привет! 👋 Я бот для изучения глаголов иврита. Спроси меня, как спрягать глагол — я покажу таблицу и объясню."
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
