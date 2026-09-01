import { readB, writeB } from '../lib/function.mjs';

// 全局变量存储授权状态
let globalStatus = {
  RC_sq: "未授权"
};

export async function checkAuthStatus(event) {
  let dir_wj_time = "";
  
  // 根据消息类型确定文件路径
  if (event.message_type == "group") {
    dir_wj_time = "筱筱吖/授权系统/授权信息/" + event.group_id + ".json";
  } else if (event.message_type != "group") {
    dir_wj_time = "筱筱吖/授权系统/授权信息/私聊.json";
  }
  
  // 读取授权数据
  const xz_time = Math.floor(Date.now() / 1000);
  const wj_time = readB(dir_wj_time, "授权时间", 0);
  const wj_km_time = readB(dir_wj_time, "卡密时长", 0);
  const jjjj = xz_time - wj_time;
  
  // 判断授权状态
  let 授权状态 = "未授权";
  if (wj_time == 0 || wj_km_time == 0) {
    授权状态 = "未授权";
  } else if (jjjj > wj_km_time) {
    // 授权到期，清空数据
    授权状态 = "未授权";
    writeB(dir_wj_time, "授权时间", 0);
    writeB(dir_wj_time, "卡密时长", 0);
  } else {
    授权状态 = "已授权";
  }
  
  // 更新全局状态
  globalStatus.RC_sq = 授权状态;
  return 授权状态;
}

export function getAuthStatus() {
  return globalStatus.RC_sq;
}

export function setAuthStatus(status) {
  globalStatus.RC_sq = status;
}
