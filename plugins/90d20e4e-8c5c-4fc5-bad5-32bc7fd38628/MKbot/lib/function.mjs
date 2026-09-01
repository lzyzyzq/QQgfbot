import fs from 'fs';
import path from 'path';

let dataPath = "";

/**
 * 设置数据文件夹路径
 * @param {string} dir - 数据文件夹路径
 */
export function setDataPath(dir) {
  dataPath = dir;
}

/**
 * 读取整个文件内容
 * @param {string} filename - 文件名
 * @returns {string} 文件内容，不存在返回空字符串
 */
export function readA(filename) {
  const filePath = path.join(dataPath, filename);
  
  try {
    if (fs.existsSync(filePath)) {
      return fs.readFileSync(filePath, "utf-8");
    }
  } catch (error) {
    console.error(`[Function] 读取文件 ${filename} 失败:`, error);
  }
  
  return "";
}

/**
 * 读取 JSON 文件中指定键的值
 * @param {string} filename - 文件名
 * @param {string} key - 键名
 * @param {any} defaultValue - 默认值（键不存在或文件不存在时返回）
 * @returns {any} 键对应的值，不存在返回默认值
 */
export function readB(filename, key, defaultValue = "") {
  const filePath = path.join(dataPath, filename);
  
  try {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, "utf-8");
      const data = JSON.parse(content);
      
      // 如果键存在且有值，返回文件中的值；否则返回默认值
      if (key in data && data[key] !== null && data[key] !== undefined) {
        return data[key];
      }
    }
  } catch (error) {
    console.error(`[Function] 读取文件 ${filename} 失败:`, error);
  }
  
  return defaultValue;
}

/**
 * 写入内容到文件（直接覆盖）
 * @param {string} filename - 文件名
 * @param {string} content - 要写入的内容
 * @returns {boolean} 是否成功
 */
export function writeA(filename, content) {
  const filePath = path.join(dataPath, filename);
  const dir = path.dirname(filePath);
  
  try {
    // 确保文件夹存在
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    fs.writeFileSync(filePath, content, "utf-8");
    return true;
  } catch (error) {
    console.error(`[Function] 写入文件 ${filename} 失败:`, error);
    return false;
  }
}

/**
 * 写入 JSON 文件中指定键的值
 * @param {string} filename - 文件名
 * @param {string} key - 键名
 * @param {any} value - 要写入的值（可以为空）
 * @returns {boolean} 是否成功
 */
export function writeB(filename, key, value) {
  const filePath = path.join(dataPath, filename);
  const dir = path.dirname(filePath);
  
  try {
    // 确保文件夹存在
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    let data = {};
    
    // 如果文件存在，先读取现有内容
    if (fs.existsSync(filePath)) {
      try {
        const content = fs.readFileSync(filePath, "utf-8");
        data = JSON.parse(content);
      } catch {
        // 如果解析失败，就用空对象
        data = {};
      }
    }
    
    // 写入或更新键值
    data[key] = value;
    
    // 写入文件
    const content = JSON.stringify(data, null, 2);
    fs.writeFileSync(filePath, content, "utf-8");
    return true;
  } catch (error) {
    console.error(`[Function] 写入文件 ${filename} 失败:`, error);
    return false;
  }
}

/**
 * 删除 JSON 文件中的指定键
 * @param {string} filename - 文件名
 * @param {string} key - 键名
 * @returns {boolean} 是否成功
 */
export function deleteKey(filename, key) {
  const filePath = path.join(dataPath, filename);
  
  try {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, "utf-8");
      const data = JSON.parse(content);
      
      delete data[key];
      
      const newContent = JSON.stringify(data, null, 2);
      fs.writeFileSync(filePath, newContent, "utf-8");
      return true;
    }
  } catch (error) {
    console.error(`[Function] 删除键失败:`, error);
    return false;
  }
  
  return false;
}

/**
 * 检查键是否存在
 * @param {string} filename - 文件名
 * @param {string} key - 键名
 * @returns {boolean} 键是否存在
 */
export function hasKey(filename, key) {
  const filePath = path.join(dataPath, filename);
  
  try {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, "utf-8");
      const data = JSON.parse(content);
      return key in data;
    }
  } catch (error) {
    console.error(`[Function] 检查键失败:`, error);
  }
  
  return false;
}

/**
 * 获取所有键
 * @param {string} filename - 文件名
 * @returns {string[]} 所有键的数组
 */
export function getKeys(filename) {
  const filePath = path.join(dataPath, filename);
  
  try {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, "utf-8");
      const data = JSON.parse(content);
      return Object.keys(data);
    }
  } catch (error) {
    console.error(`[Function] 获取键失败:`, error);
  }
  
  return [];
}

/**
 * 清空文件（写入空对象）
 * @param {string} filename - 文件名
 * @returns {boolean} 是否成功
 */
export function clear(filename) {
  return writeA(filename, "{}");
}











export function moneyA(number) {
    let AC比例 = 100000; // 1玉令 = 多少归笺
    let BC比例 = 1000;   // 1玉笺 = 多少归笺
    const erci = Math.ceil(number);//向上取整
    // ================== 计算 ==================
    let RC_moneyA = "";
    if(erci != 0){
        let 利润_换算_玉令 = Math.floor(number / AC比例);
        let 利润_换算_玉笺 = Math.floor((number % AC比例) / BC比例);
        let 利润_换算_归笺 = Math.floor(number % BC比例);
        if(利润_换算_玉令 != 0){
            RC_moneyA += `${利润_换算_玉令}玉令`;
        }
        if(利润_换算_玉笺 != 0){
            RC_moneyA += `${利润_换算_玉笺}玉笺`;
        }
        RC_moneyA += `${利润_换算_归笺}归笺`;
    }else{
        RC_moneyA += `${erci}归笺`;
    }
    // ================== 输出 ==================
    return RC_moneyA;
}


















/**
 * 格式化时间戳
 * @param {string} format - 格式字符串 (y=年, m=月, d=日, H=时, i=分, s=秒)
 * @param {number} timestamp - 时间戳（秒），不传则使用当前时间
 * @returns {string} 格式化后的时间字符串
 * 
 * @example
 * timeA("y-m-d H:i:s");           // 输出：2026-01-31 12:22:00
 * timeA("y-m-d H:i:s", 1769834476);  // 输出：2026-01-31 12:22:00
 */
export function timeA(format, timestamp) {
  const ts = timestamp ? timestamp : Math.floor(Date.now() / 1000);
  const date = new Date(ts * 1000);
  
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  
  return format
    .replace(/y/g, year)
    .replace(/m/g, month)
    .replace(/d/g, day)
    .replace(/H/g, hours)
    .replace(/i/g, minutes)
    .replace(/s/g, seconds);
}

/**
 * 生成随机整数或随机字母
 * @param {number|string} min - 最小值（包含）或起始字母
 * @param {number|string} max - 最大值（包含）或结束字母
 * @returns {number|string} 随机整数或随机字母
 * 
 * @example
 * rand(0, 100);      // 0 到 100 之间的随机整数
 * rand(1, 10);       // 1 到 10 之间的随机整数
 * rand('a', 'z');    // a 到 z 之间的随机小写字母
 * rand('A', 'Z');    // A 到 Z 之间的随机大写字母
 * rand('a', 'Z');    // a-z 和 A-Z 之间的随机字母（无视大小写）
 */
export function rand(min, max) {
  // 如果是数字，返回随机整数
  if (typeof min === 'number' && typeof max === 'number') {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }
  
  // 如果是字母
  if (typeof min === 'string' && typeof max === 'string') {
    const minChar = min.toLowerCase();
    const maxChar = max.toLowerCase();
    
    // 如果两个都是小写，或者一个大一个小（无视大小写）
    if (minChar === min && maxChar === max) {
      // 都是小写：a-z
      const minCode = min.charCodeAt(0);
      const maxCode = max.charCodeAt(0);
      const randomCode = Math.floor(Math.random() * (maxCode - minCode + 1)) + minCode;
      return String.fromCharCode(randomCode);
    } else if (minChar === min && maxChar !== max) {
      // 第一个小写，第二个大写：无视大小写，返回 a-z 和 A-Z 混合
      const allLetters = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
      return allLetters[Math.floor(Math.random() * allLetters.length)];
    } else if (minChar !== min && maxChar === max) {
      // 第一个大写，第二个小写：无视大小写，返回 a-z 和 A-Z 混合
      const allLetters = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
      return allLetters[Math.floor(Math.random() * allLetters.length)];
    } else {
      // 都是大写：A-Z
      const minCode = min.charCodeAt(0);
      const maxCode = max.charCodeAt(0);
      const randomCode = Math.floor(Math.random() * (maxCode - minCode + 1)) + minCode;
      return String.fromCharCode(randomCode);
    }
  }
  
  return null;
}


/**
 * 计算时间戳剩余时间（智能降级）
 * @param {string} format - 格式字符串 (y=年, m=月, d=日, H=时, i=分, s=秒)
 * @param {number} timestamp - 时间戳（秒）
 * @returns {string} 格式化后的剩余时间字符串
 * 
 * @example
 * timeB("y-m-d H:i:s", 31536000);  // 输出：01-00-00 00:00:00 (1年)
 * timeB("d H:i:s", 313718400);     // 输出：3631 12:00:00 (没有年月，所以天数不降级)
 * timeB("d H:i:s", 86400);         // 输出：01 00:00:00 (1天)
 */
export function timeB(format, timestamp) {
  let remaining = timestamp;
  
  // 判断格式字符串中包含哪些单位
  const hasYear = format.includes('y');
  const hasMonth = format.includes('m');
  const hasDay = format.includes('d');
  const hasHour = format.includes('H');
  const hasMinute = format.includes('i');
  const hasSecond = format.includes('s');
  
  // 根据格式字符串智能计算单位
  let years = 0, months = 0, days = 0, hours = 0, minutes = 0, seconds = 0;
  
  if (hasYear) {
    years = Math.floor(remaining / 31536000);
    remaining %= 31536000;
  }
  
  if (hasMonth) {
    months = Math.floor(remaining / 2678400);
    remaining %= 2678400;
  }
  
  if (hasDay) {
    days = Math.floor(remaining / 86400);
    remaining %= 86400;
  }
  
  if (hasHour) {
    hours = Math.floor(remaining / 3600);
    remaining %= 3600;
  }
  
  if (hasMinute) {
    minutes = Math.floor(remaining / 60);
    remaining %= 60;
  }
  
  if (hasSecond) {
    seconds = remaining;
  }
  
  // 根据格式字符串决定是否需要补零
  const needsZeroPad = (value) => String(value).padStart(2, '0');
  
  // 替换格式字符串中的占位符
  let result = format;
  
  result = result.replace(/y+/g, (match) => {
    return match.length === 1 ? years : needsZeroPad(years);
  });
  
  result = result.replace(/m+/g, (match) => {
    return match.length === 1 ? months : needsZeroPad(months);
  });
  
  result = result.replace(/d+/g, (match) => {
    return match.length === 1 ? days : needsZeroPad(days);
  });
  
  result = result.replace(/H+/g, (match) => {
    return match.length === 1 ? hours : needsZeroPad(hours);
  });
  
  result = result.replace(/i+/g, (match) => {
    return match.length === 1 ? minutes : needsZeroPad(minutes);
  });
  
  result = result.replace(/s+/g, (match) => {
    return match.length === 1 ? seconds : needsZeroPad(seconds);
  });
  
  return result;
}

