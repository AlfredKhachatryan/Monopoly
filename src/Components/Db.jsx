// db.js
import { openDB } from "idb";

// Переменная для хранения ссылки на открытую базу данных
let dbInstance = null;

// Инициализация базы данных
const initDB = async () => {
  if (!dbInstance) {
    dbInstance = await openDB("my-database", 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains("keyval")) {
          db.createObjectStore("keyval");
        }
      },
    });
  }

  return dbInstance;
};
// Установка значения
export const setItem = async (key, value) => {
  const db = await initDB();
  const channel = new BroadcastChannel("indexedDB_channel");
  channel.postMessage({ type: "UPDATE", payload: { key, value } });
  channel.close();
  return db.put("keyval", value, key);
};

// Получение значения
export const getItem = async (key) => {
  const db = await initDB();
  return db.get("keyval", key);
};
