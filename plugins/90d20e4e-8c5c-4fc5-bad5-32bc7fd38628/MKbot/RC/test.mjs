// 测试处理器 - 练习用
import { readA, readB, writeA, writeB, deleteKey , timeA , timeB , rand , moneyA } from '../lib/function.mjs';
import { giveAT, giveImages, giveText , sendReply , sendForward , BOTAPI } from '../lib/Bot.mjs';
import { checkAuthStatus, getAuthStatus } from './const.mjs';

// ================== 处理正常消息 ==================
export async function handleMessage(message, event, ctx) {
// ================== 授权部分 ==================
// ================== 群管部分 ==================

// ================== 全局开关 - 群聊 ==================
const group_ofs = readB("config.json", "group_of", []);
const hdhbedk = String(event.group_id);
const isGroups = group_ofs.includes(hdhbedk);
if(!isGroups){
    return null;
}

// ================== 群号检测 ==================
if (event.group_id !== 101311160 && event.group_id !== 1082631686) {
    return null;
}


// ================== 全局变量 ==================
await checkAuthStatus(event);
const RC_sq = getAuthStatus();//授权状态
const array_shijian = ["禁言通知","入群验证"];
const RC_group_role ={
    "owner":3,
    "admin":2,
    "member":1,
    "unknown":0
};






// ================== 授权部分 ==================
if(message.match(/^授权判断([0-9]+|)$/)){
    // ================== 添加来源 ==================
    let 来源 = "未知";
    let dir_wj_time = "";
    const two_km = message.match(/^授权判断([0-9]+|)$/)[1];//自选目标
    if(event.message_type == "group" && two_km == ""){//群聊
        来源 = `群聊(${event.group_id})`;
        dir_wj_time = "筱筱吖/授权系统/授权信息/"+event.group_id+".json";
    }else if(event.message_type != "group" && two_km == ""){//私聊
        来源 = `私聊`;
        dir_wj_time = "筱筱吖/授权系统/授权信息/私聊.json";
    }else if(two_km != ""){//目标不为空时
        来源 = `群聊(${two_km})`;
        dir_wj_time = "筱筱吖/授权系统/授权信息/"+two_km+".json";
    }else{
        await sendReply(event, `[CQ:reply,id=${event.message_id}]出现未知类型报错`, ctx);
        return null;
    }
    
    // ================== 获取来源数据 ==================
    const xz_time = Math.floor(Date.now() / 1000);//现在时间戳秒
    const wj_time = readB(dir_wj_time, "授权时间", 0);//记录的时间
    const wj_km_time = readB(dir_wj_time, "卡密时长", 0);//记录卡密的时长
    const jjjj = xz_time - wj_time;//距离首次授权已过多久
        
    // ================== 检 ==================
    if(jjjj < wj_km_time){
        const scsq_time = timeA("y-m-d H:i:s", wj_time);//首次授权时间
        const sysc_time = timeB("d天H时i分s秒", wj_km_time - jjjj);//剩余的授权时间
        const expireDateStr = timeA("y-m-d H:i:s", wj_time + wj_km_time);//到期时间
        let 组装消息 = `${来源} - 授权数据`;
        组装消息 += `\n══════════════`;
        组装消息 += `\n[授权时间]:${scsq_time}`;
        组装消息 += `\n[剩余时长]:${sysc_time}`;
        组装消息 += `\n[到期时间]:${expireDateStr}`;
        组装消息 += `\n══════════════`;
        await sendReply(event, `[CQ:reply,id=${event.message_id}]${组装消息}`, ctx);
    }else{
        const scsq_time = timeA("y-m-d H:i:s", wj_time);//首次授权时间
        const expireDateStr = timeA("y-m-d H:i:s", wj_time + wj_km_time);//到期时间
        let 组装消息 = `${来源} - 授权数据`;
        组装消息 += `\n══════════════`;
        组装消息 += `\n[授权时间]:${scsq_time}`;
        组装消息 += `\n[到期时间]:${expireDateStr}`;
        组装消息 += `\n══════════════`;
        await sendReply(event, `[CQ:reply,id=${event.message_id}]${组装消息}`, ctx);
    }
    return null;
}





if(message == "授权系统"){
    // ================== 组装返回内容 ==================
    let 返回内容1 = "用户指令:";
    返回内容1 += `\n══════════════`;
    返回内容1 += `\n授权判断`;
    返回内容1 += `\n授权判断[群号]`;
    返回内容1 += `\n使用卡密[卡密]`;
    返回内容1 += `\n══════════════`;
    // ================== 组装返回内容 - 2 ==================
    let 返回内容2 = "后台指令:";
    返回内容2 += `\n══════════════`;
    返回内容2 += `\n - 单次生成`;
    返回内容2 += `\n生成天卡授权  生`;
    返回内容2 += `\n生成周卡授权  成`;
    返回内容2 += `\n生成月卡授权  卡`;
    返回内容2 += `\n生成半年授权  密`;
    返回内容2 += `\n生成年卡授权  授`;
    返回内容2 += `\n生成永久授权  权`;
    返回内容2 += `\n - 批量生成`;
    返回内容2 += `\n生成天卡授权[数量]  批`;
    返回内容2 += `\n生成周卡授权[数量]  量`;
    返回内容2 += `\n生成月卡授权[数量]  生`;
    返回内容2 += `\n生成半年授权[数量]  成`;
    返回内容2 += `\n生成年卡授权[数量]  授`;
    返回内容2 += `\n生成永久授权[数量]  权`;
    返回内容2 += `\n`;
    返回内容2 += `\n - 添加到当前群聊`;
    返回内容2 += `\n添加天卡授权  添`;
    返回内容2 += `\n添加周卡授权  加`;
    返回内容2 += `\n添加月卡授权  本`;
    返回内容2 += `\n添加半年授权  群`;
    返回内容2 += `\n添加年卡授权  授`;
    返回内容2 += `\n添加永久授权  权`;
    返回内容2 += `\n - 添加到指定群聊`;
    返回内容2 += `\n添加天卡授权[群号]  跨`;
    返回内容2 += `\n添加周卡授权[群号]  群`;
    返回内容2 += `\n添加月卡授权[群号]  添`;
    返回内容2 += `\n添加半年授权[群号]  加`;
    返回内容2 += `\n添加年卡授权[群号]  授`;
    返回内容2 += `\n添加永久授权[群号]  权`;
    返回内容2 += `\n`;
    返回内容2 += `\n - 看列表的`;
    返回内容2 += `\n卡密列表`;
    返回内容2 += `\n`;
    返回内容2 += `\n - 删除卡密`;
    返回内容2 += `\n删除卡密[卡密]`;
    返回内容2 += `\n清空全部`;
    返回内容2 += `\n`;
    返回内容2 += `\n - 取消授权`;
    返回内容2 += `\n删除授权`;
    返回内容2 += `\n删除授权[群号]`;
    返回内容2 += `\n══════════════`;
    // ================== 输出消息 ==================
    const messages = [
        { text: 返回内容1, name: "[授权系统]", qq: event.self_id },
        { text: 返回内容2, name: "[授权系统]", qq: event.self_id }
    ];
    await sendForward(event, messages, ctx);
    return null;
}









if (message.match(/^生成(天|周|月|半年|年|永久)(卡|)授权([0-9]+|)$/)) {
    // ================== 最高主人检测 ==================
    const ownerQQs = readB("config.json", "OwnerQQs", []);
    const userQQ = String(event.user_id);
    const isOwner = ownerQQs.includes(userQQ);
    if(!isOwner){
        const nowoner = readB("config.json", "nowoner", false);
        const nowonernr = readB("config.json", "nowonernr", "你不是她......");
        if(nowoner){
            if(nowonernr != ""){
                await sendReply(event, `[CQ:reply,id=${event.message_id}]${nowonernr}`, ctx);
            }
            return null;
        }else{
            return null;
        }
    }
    
    // ================== 取出所输入的值 ==================
    const one_km = message.match(/^生成(天|周|月|半年|年|永久)(卡|)授权([0-9]+|)$/)[1];//卡密类型
    const two_km = (message.match(/^生成(天|周|月|半年|年|永久)(卡|)授权([0-9]+|)$/)[3] || 1);
    
    // ================== 判断合理性 ==================
    if(two_km <= 0 || two_km >= 101){
      await sendReply(event, `[CQ:reply,id=${event.message_id}]请正常给我参数哦～`, ctx);
      return null;
    }
    
    // ================== 卡密时间表 ==================
    const km_time_type ={
        "天": 86400,
        "周": 604800,
        "月": 2678400,
        "半年": 15724800,
        "年": 31622400,
        "永久": 311040000
    };
    let km_time = km_time_type[one_km];//获取卡密时长
  
    // ================== 循环 ==================
    let 循环次数 = two_km;
    let 本次序号 = 0;
    let 组装消息 = `已生成【${循环次数}】张【${one_km}卡】`;
    for(let i = 0; i < 循环次数; i++) {
        本次序号 = i + 1;
        let km_key = "MK"+rand(100000, 999999)+Math.floor(Date.now() / 1000);
        let 内容 = {类型:one_km, 时长:km_time};
        writeB("筱筱吖/授权系统/卡密管理/卡密数据.json", km_key, 内容);
        组装消息 += `\n【${本次序号}】${km_key}`;
    }
  
    // ================== 输出 ==================
    await sendReply(event, `[CQ:reply,id=${event.message_id}]已发给你的私聊啦，请查收～`, ctx);
    const fakeEvent = {//安全输出
        message_type: "private",
        user_id: event.user_id //目标QQ
    };
    if(循环次数 > 10){
        const messages = [
            { text: 组装消息, name: "[新的卡密]", qq: event.self_id }
        ];
        await sendForward(fakeEvent, messages, ctx);
    }else{
      await sendReply(fakeEvent, `${组装消息}`, ctx);
    }
    return null;
}




if (message.match(/^添加(天|周|月|半年|年|永久)(卡|)授权([0-9]+|)$/)) {
    // ================== 最高主人检测 ==================
    const ownerQQs = readB("config.json", "OwnerQQs", []);
    const userQQ = String(event.user_id);
    const isOwner = ownerQQs.includes(userQQ);
    if(!isOwner){
        const nowoner = readB("config.json", "nowoner", false);
        const nowonernr = readB("config.json", "nowonernr", "你不是她......");
        if(nowoner){
            if(nowonernr != ""){
                await sendReply(event, `[CQ:reply,id=${event.message_id}]${nowonernr}`, ctx);
            }
            return null;
        }else{
            return null;
        }
    }
  
    // ================== 取出所输入的值 ==================
    const one_km = message.match(/^添加(天|周|月|半年|年|永久)(卡|)授权([0-9]+|)$/)[1];//卡密类型
    const two_km = message.match(/^添加(天|周|月|半年|年|永久)(卡|)授权([0-9]+|)$/)[3];//自选目标
    //构建空值
    let dir_wj_time = "";
    if(event.message_type == "group" && two_km == ""){//如果消息是群聊的及自选目标为空
        dir_wj_time = "筱筱吖/授权系统/授权信息/"+event.group_id+".json";
    }else if(event.message_type != "group" && two_km == ""){//私聊单加
        dir_wj_time = "筱筱吖/授权系统/授权信息/私聊.json";
    }else if(two_km != ""){//目标不为空时
        dir_wj_time = "筱筱吖/授权系统/授权信息/"+two_km+".json";
    }else{
        await sendReply(event, `[CQ:reply,id=${event.message_id}]出现未知类型报错`, ctx);
        return null;
    }
    
    // ================== 获取数据 ==================
    const xz_time = Math.floor(Date.now() / 1000);//现在时间戳秒
    const wj_time = readB(dir_wj_time, "授权时间", 0);//记录的时间
    const wj_km_time = readB(dir_wj_time, "卡密时长", 0);//记录卡密的时长
    const jjjj = xz_time - wj_time;
    
    // ================== 读取固定数据 ==================
    const km_time_type ={//卡密时间表
        "天": 86400,
        "周": 604800,
        "月": 2678400,
        "半年": 15724800,
        "年": 31622400,
        "永久": 311040000
    };
    let km_time = km_time_type[one_km];
    //await sendReply(event, `[CQ:reply,id=${event.message_id}]当前值:${km_time} | 类型值:${one_km}`, ctx);
    
    // ================== 检测是否到期 ==================
    let 添加方式 = "";
    let extime = 0;
    if(jjjj > wj_km_time){//如果已过时间大于授权时间
        添加方式 = "重新添加授权";
        extime = xz_time + km_time;
        //await sendReply(event, `[CQ:reply,id=${event.message_id}]授权已到期，重新增加`, ctx);
        writeB(dir_wj_time, "授权时间", xz_time);
        writeB(dir_wj_time, "卡密时长", km_time);
    }else{//卡密没到期
        添加方式 = "续期卡密时长";
        extime = xz_time + km_time + wj_km_time;
        //await sendReply(event, `[CQ:reply,id=${event.message_id}]授权还在，正在续期....`, ctx);
        writeB(dir_wj_time, "卡密时长", km_time + wj_km_time);
    }
    
    // ================== 组装输出内容 ==================
    const expireDateStr = timeA("y-m-d H:i:s", extime);
    let 组装消息 = ``;
    组装消息 += `══════════════`;
    组装消息 += `\n已${添加方式}`;
    组装消息 += `\n[卡密类型]:${one_km}卡`;
    组装消息 += `\n[新增时长]:${km_time}秒`;
    组装消息 += `\n[到期时间]:${expireDateStr}`;
    组装消息 += `\n══════════════`;
    await sendReply(event, `[CQ:reply,id=${event.message_id}]${组装消息}`, ctx);
    return null;
}



if(message.match(/^使用卡密([\s\S]*)$/)){
    // ================== 取出所输入的值 ==================
    const one_km = message.match(/^使用卡密([\s\S]*)$/)[1];//卡密
    
    // ================== 读取文件数据 ==================
    const data = readB("筱筱吖/授权系统/卡密管理/卡密数据.json", one_km, {});
    
    // ================== 取值 ==================
    let 卡密类型 = data["类型"];
    let 卡密时长 = data["时长"];
    
    // ================== 判断 ==================
    if(卡密类型 === undefined || 卡密时长 === undefined){
        await sendReply(event, `[CQ:reply,id=${event.message_id}]卡密无效！`, ctx);
        return null;
    }else{
        // ================== 添加来源 ==================
        let 来源 = "未知";
        let dir_wj_time = "";
        if(event.message_type == "group"){
            来源 = `群聊(${event.group_id})`;
            dir_wj_time = "筱筱吖/授权系统/授权信息/"+event.group_id+".json";
        }else if(event.message_type != "group"){
           来源 = "私聊";
            dir_wj_time = "筱筱吖/授权系统/授权信息/私聊.json";
        }else{
            await sendReply(event, `[CQ:reply,id=${event.message_id}]出现未知类型报错`, ctx);
            return null;
        }
        
        // ================== 获取来源数据 ==================
        const xz_time = Math.floor(Date.now() / 1000);//现在时间戳秒
        const wj_time = readB(dir_wj_time, "授权时间", 0);//记录的时间
        const wj_km_time = readB(dir_wj_time, "卡密时长", 0);//记录卡密的时长
        const jjjj = xz_time - wj_time;
        
        // ================== 检测来源数据是否到期 ==================
        let 添加方式 = "";
        let extime = 0;
        if(jjjj > wj_km_time){//到期
            添加方式 = "重新添加授权";
            extime = xz_time + 卡密时长;
            //await sendReply(event, `[CQ:reply,id=${event.message_id}]授权已到期，重新增加`, ctx);
            writeB(dir_wj_time, "授权时间", xz_time);
            writeB(dir_wj_time, "卡密时长", 卡密时长);
        }else{//卡密没到期
            添加方式 = "续期卡密时长";
            extime = xz_time + 卡密时长 + wj_km_time;
            //await sendReply(event, `[CQ:reply,id=${event.message_id}]授权还在，正在续期....`, ctx);
            writeB(dir_wj_time, "卡密时长", 卡密时长 + wj_km_time);
        }
    
        // ================== 组装输出 ==================
        const expireDateStr = timeA("y-m-d H:i:s", extime);
        let 组装消息 = "";
        组装消息 += `══════════════`;
        组装消息 += `\n[使用目标]:${来源}`;
        组装消息 += `\n[增加模式]:${添加方式}`;
        组装消息 += `\n[卡密类型]:${卡密类型}卡`;
        组装消息 += `\n[新增时长]:${卡密时长}秒`;
        组装消息 += `\n[到期时间]:${expireDateStr}`;
        组装消息 += `\n══════════════`;
        await sendReply(event, `[CQ:reply,id=${event.message_id}]${组装消息}`, ctx);
    }
    
    // ================== 删除卡密 ==================
    deleteKey("筱筱吖/授权系统/卡密管理/卡密数据.json", one_km);//删除键
    return null;
}






if(message.match(/^(删除|清空)卡密([\s\S]*)$/)){
    // ================== 最高主人检测 ==================
    const ownerQQs = readB("config.json", "OwnerQQs", []);
    const userQQ = String(event.user_id);
    const isOwner = ownerQQs.includes(userQQ);
    if(!isOwner){
        const nowoner = readB("config.json", "nowoner", false);
        const nowonernr = readB("config.json", "nowonernr", "你不是她......");
        if(nowoner){
            if(nowonernr != ""){
                await sendReply(event, `[CQ:reply,id=${event.message_id}]${nowonernr}`, ctx);
            }
            return null;
        }else{
            return null;
        }
    }

    // ================== 取出所输入的值 ==================
    const ly_km = message.match(/^(删除|清空)卡密([\s\S]*)$/)[1];//方式
    const one_km = message.match(/^(删除|清空)卡密([\s\S]*)$/)[2];//卡密
    
    // ================== 读取文件数据 ==================
    const data = readB("筱筱吖/授权系统/卡密管理/卡密数据.json", one_km, {});
    let 卡密类型 = data["类型"];
    let 卡密时长 = data["时长"];
    
    // ================== 判断有效性 ==================
    if((卡密类型 === undefined || 卡密时长 === undefined) && ly_km != "清空"){
        await sendReply(event, `[CQ:reply,id=${event.message_id}]卡密不存在！`, ctx);
        return null;
    }
    
    // ================== 处理类型 ==================
    if(ly_km == "清空"){
        writeA("筱筱吖/授权系统/卡密管理/卡密数据.json", "{}");
        await sendReply(event, `[CQ:reply,id=${event.message_id}]已清空现在有的全部卡密啦～！`, ctx);
        return null;
    }else{
        // ================== 删除卡密 ==================
        deleteKey("筱筱吖/授权系统/卡密管理/卡密数据.json", one_km);//删除单个卡密
        await sendReply(event, `[CQ:reply,id=${event.message_id}]已删除卡密【${one_km}】`, ctx);
        return null;
    }
}


if(message == "卡密列表"){
    // ================== 最高主人检测 ==================
    const ownerQQs = readB("config.json", "OwnerQQs", []);
    const userQQ = String(event.user_id);
    const isOwner = ownerQQs.includes(userQQ);
    if(!isOwner){
        const nowoner = readB("config.json", "nowoner", false);
        const nowonernr = readB("config.json", "nowonernr", "你不是她......");
        if(nowoner){
            if(nowonernr != ""){
                await sendReply(event, `[CQ:reply,id=${event.message_id}]${nowonernr}`, ctx);
            }
            return null;
        }else{
            return null;
        }
    }
    
    // ================== 读取数据 ==================
    const km_content = readA("筱筱吖/授权系统/卡密管理/卡密数据.json");
    let km_data = {};
    if (km_content && km_content.trim()) {
        try {
            km_data = JSON.parse(km_content);
        } catch (e) {
            km_data = {};
        }
    }
    const km_count = Object.keys(km_data).length;//卡密数量
    
    // ================== 如果没卡密 ==================
    if(km_count == 0){
        await sendReply(event, `[CQ:reply,id=${event.message_id}]目前没有卡密哦～`, ctx);
        return null;
    }
    
    // ================== 循环前置 ==================
    let 组装消息 = "";
    let 序号 = 1;
    let 永久卡数量 = 0;
    let 年卡数量 = 0;
    let 半年卡数量 = 0;
    let 月卡数量 = 0;
    let 周卡数量 = 0;
    let 天卡数量 = 0;
    // ================== 循环 ==================
    for (const [键, 值] of Object.entries(km_data)) {
        let 本次类型 = 值["类型"];
        let 本次时长 = 值["时长"];
        
        // ================== 如果任意内容为空 ==================
        if(本次类型 == undefined || 本次时长 == undefined){
            continue;
        }
        组装消息 += `\n${序号}.[${本次类型}卡]:【${键}】`;
        序号++;
        
        // ================== 增加记录 ==================
        if(本次类型 == "永久"){
            永久卡数量++;
        }else if(本次类型 == "年"){
            年卡数量++;
        }else if(本次类型 == "半年"){
            半年卡数量++;
        }else if(本次类型 == "月"){
            月卡数量++;
        }else if(本次类型 == "周"){
            周卡数量++;
        }else{
            天卡数量++;
        }
    }
    
    // ================== 组装输出 ==================
    let 组装消息2 = `共计【${km_count}】张卡密`;
    组装消息2 += `\n══════════════`;
    组装消息2 += `\n[天卡]:${天卡数量}`;
    组装消息2 += `\n[周卡]:${周卡数量}`;
    组装消息2 += `\n[月卡]:${月卡数量}`;
    组装消息2 += `\n[半年]:${半年卡数量}`;
    组装消息2 += `\n[年卡]:${年卡数量}`;
    组装消息2 += `\n[永久]:${永久卡数量}`;
    组装消息2 += `\n══════════════`;
    
    // ================== 输出 ==================
    await sendReply(event, `[CQ:reply,id=${event.message_id}]已发给你的私聊啦，请查收～`, ctx);
    const fakeEvent = {//安全输出
        message_type: "private",
        user_id: event.user_id //目标QQ
    };
    const messages = [
        { text: 组装消息2+组装消息, name: "[授权系统]", qq: event.self_id }
    ];
    await sendForward(fakeEvent, messages, ctx);
}



if(message.match(/^(删除|取消)授权([\s\S]*)$/)){
    // ================== 最高主人检测 ==================
    const ownerQQs = readB("config.json", "OwnerQQs", []);
    const userQQ = String(event.user_id);
    const isOwner = ownerQQs.includes(userQQ);
    if(!isOwner){
        const nowoner = readB("config.json", "nowoner", false);
        const nowonernr = readB("config.json", "nowonernr", "你不是她......");
        if(nowoner){
            if(nowonernr != ""){
                await sendReply(event, `[CQ:reply,id=${event.message_id}]${nowonernr}`, ctx);
            }
            return null;
        }else{
            return null;
        }
    }
    
    const one_km = message.match(/^(删除|取消)授权([\s\S]*)$/)[2];//目标
    // ================== 获取文件 ==================
    let mub = "";
    let dir_wj_time = "";
    if(event.message_type == "group" && one_km == ""){//群聊
        mub = event.group_id;
        dir_wj_time = "筱筱吖/授权系统/授权信息/"+event.group_id+".json";
        
    }else if(event.message_type != "group" && one_km == ""){//私聊
        mub = "私聊"
        dir_wj_time = "筱筱吖/授权系统/授权信息/私聊.json";
        
    }else if(one_km != ""){//目标
        mub = one_km;
        dir_wj_time = "筱筱吖/授权系统/授权信息/"+one_km+".json";
        
    }else{
        await sendReply(event, `[CQ:reply,id=${event.message_id}]出现未知类型报错`, ctx);
        return null;
        
    }
    
    // ================== 重置时间 ==================
    writeB(dir_wj_time, "授权时间", 0);
    writeB(dir_wj_time, "卡密时长", 0);

    // ================== 输出结果 ==================
    await sendReply(event, `[CQ:reply,id=${event.message_id}]我这就去把【${mub}】的授权状态给bian了！`, ctx);
    return null;
}












// ================== 群管部分 ==================
if(message == "群管系统" || message == "群管功能"){
    // ================== 授权判断 ==================
    if(RC_sq != "已授权"){
        await sendReply(event, `[CQ:reply,id=${event.message_id}]MK没能量啦～要充电电～～`, ctx);
        return null;
    }
    
    // ================== 组装消息 - 1 ==================
    let 组装消息1 = "══════════════";
    组装消息1 += `\n【群管系统】`;
    组装消息1 += `\n禁言@人 [时间]`;
    组装消息1 += `\n解禁@人`;
    组装消息1 += `\n上管@人`;
    组装消息1 += `\n下管@人`;
    组装消息1 += `\n踢出@人`;
    组装消息1 += `\n黑踢@人`;
    组装消息1 += `\n获取禁言列表`;
    组装消息1 += `\n══════════════`;
    // ================== 输出消息 - 2 ==================
    let 组装消息2 = `══════════════`;
    组装消息2 += `\n【入群审核】`;
    组装消息2 += `\n`;
    组装消息2 += `\n切换类型的↓`;
    组装消息2 += `\n - 设置入群审核条件[准确|包含|模糊多重|准确多重|字数]`;
    组装消息2 += `\n`;
    组装消息2 += `\n设置每人单天的可用次数的↓`;
    组装消息2 += `\n设置入群审核单日次数[数量]`;
    组装消息2 += `\n`;
    组装消息2 += `\n字数条件的↓`;
    组装消息2 += `\n - 设置入群审核字数数量[数量]`;
    组装消息2 += `\n`;
    组装消息2 += `\n准确&包含条件的↓`;
    组装消息2 += `\n - 设置入群审核答案[内容]`;
    组装消息2 += `\n`;
    组装消息2 += `\n多重条件的↓`;
    组装消息2 += `\n - 新增审核条件[内容]`;
    组装消息2 += `\n - 删除审核条件[内容]`;
    组装消息2 += `\n - 查看多重条件列表`;
    组装消息2 += `\n══════════════`;
    组装消息2 += `\n详细数据看「功能解析」`;
    
    // ================== 输出 ==================
    const messages = [
        { text: 组装消息1, name: "[群管系统]", qq: event.self_id },
        { text: 组装消息2, name: "[群管系统]", qq: event.self_id }
    ];
    await sendForward(event, messages, ctx);
}



if(message.match(/^(全体|全)(禁言|解禁|禁|解)$/)){
    // ================== 来源 ==================
    if(event.message_type != "group"){
        return null;
    }
    
    // ================== 授权判断 ==================
    if(RC_sq != "已授权"){
        await sendReply(event, `[CQ:reply,id=${event.message_id}]MK没能量啦～要充电电～～`, ctx);
        return null;
    }
    // ================== 最高主人检测 ==================
    const ownerQQs = readB("config.json", "OwnerQQs", []);
    const userQQ = String(event.user_id);
    const isOwner = ownerQQs.includes(userQQ);
    if(!isOwner){
        const nowoner = readB("config.json", "nowoner", false);
        const nowonernr = readB("config.json", "nowonernr", "你不是她......");
        if(nowoner){
            if(nowonernr != ""){
                await sendReply(event, `[CQ:reply,id=${event.message_id}]${nowonernr}`, ctx);
            }
            return null;
        }else{
            return null;
        }
    }
    
    // ================== 取类型 ==================
    const jy_tok = message.match(/^(全体|全)(禁言|解禁|禁|解)$/)[2];//值
    let jy_token = true;
    if(jy_tok == "建议" || jy_tok == "禁"){
        jy_token = true;
    }else{
        jy_token = false;
    }
    
    // ================== 管理员身份验证 ==================
    let 参数188 = {group_id : event.group_id,user_id : event.self_id};
    const dp188 = await BOTAPI(ctx, "get_group_member_info", 参数188);
    let Robot身份 = (RC_group_role[(dp188?.role || "member")] || 0);
    if(Robot身份 < 2){
        await sendReply(event, `[CQ:reply,id=${event.message_id}]窝没有群管权限唉～`, ctx);
        return null;
    }
    
    // ================== 访问接口 ==================
    let 参数 = {
        group_id : event.group_id,
        enable : jy_token
    };
    //调用
    const dp = await BOTAPI(ctx, "set_group_whole_ban", 参数);
    
    // ================== 输出 ==================
    if(jy_tok == "禁言" || jy_tok == "禁"){
        await sendReply(event, `[CQ:reply,id=${event.message_id}]这就把全体禁言给打开，让大家都不能说话！`, ctx);
    }else{
        await sendReply(event, `[CQ:reply,id=${event.message_id}]大家又可以说话啦！`, ctx);
    }
    return null;
}


if(message.match(/^(禁言|解禁)([\s\S]*?)(?:\s+(\d+))?$/)){
    // ================== 授权判断 ==================
    if(RC_sq != "已授权"){
        await sendReply(event, `[CQ:reply,id=${event.message_id}]MK没能量啦～要充电电～～`, ctx);
        return null;
    }
    
    // ================== 最高主人检测 ==================
    const ownerQQs = readB("config.json", "OwnerQQs", []);
    const userQQ = String(event.user_id);
    const isOwner = ownerQQs.includes(userQQ);
    if(!isOwner){
        const nowoner = readB("config.json", "nowoner", false);
        const nowonernr = readB("config.json", "nowonernr", "你不是她......");
        if(nowoner){
            if(nowonernr != ""){
                await sendReply(event, `[CQ:reply,id=${event.message_id}]${nowonernr}`, ctx);
            }
            return null;
        }else{
            return null;
        }
    }
    
    // ================== 获取数值 ==================
    const mub_ly = message.match(/^(禁言|解禁)([\s\S]*?)(?:\s+(\d+))?$/)[1];//值
    let mub_time = (message.match(/^(禁言|解禁)([\s\S]*?)(?:\s+(\d+))?$/)[3] || 60);
    const atUsers = giveAT(event.message);
    const rs = (atUsers.length || 0);//获取艾特人数
    
    // ================== 判断人数 ==================
    if(rs == 0){
        //await sendReply(event, `[CQ:reply,id=${event.message_id}]请要艾特别人发送哦～`, ctx);
        return null;
    }
    
    // ================== 事前准备 ==================
    let 参数188 = {group_id : event.group_id,user_id : event.self_id};
    const dp188 = await BOTAPI(ctx, "get_group_member_info", 参数188);
    let Robot身份 = (RC_group_role[(dp188?.role || "member")] || 0);//机器人身份等级
    if(Robot身份 < 2){
        await sendReply(event, `[CQ:reply,id=${event.message_id}]窝没有群管权限唉～`, ctx);
        return null;
    }
    
    // ================== 获取类型&时间 ==================
    if(mub_ly == "禁言"){
        mub_time = mub_time;
    }else{
        mub_time = 0;
    }
    
    // ================== 循环 ==================
    let 组装消息 = "";
    let 有效人数 = 0;
    for(let i = 0; i <  rs; i++) {
        let 本次QQ = atUsers[i];
        // ================== 身份验证 ==================
        let 参数199 = {group_id : event.group_id,user_id : 本次QQ};
        let dp199 = await BOTAPI(ctx, "get_group_member_info", 参数199);
        let User身份 = (RC_group_role[(dp199?.role || "member")] || 0);//目标身份
        if(User身份 >= Robot身份){//比机器人大 | 同级
            组装消息 += `\n❌${i+1}.${本次QQ}:权限不足`;
            continue;
        }else{
            // ================== 调用接口 ==================
            if(mub_ly == "禁言"){
                组装消息 += `\n✅${i+1}.${本次QQ}:禁言${mub_time}秒`;
            }else{
                组装消息 += `\n✅${i+1}.${本次QQ}:解禁成功`;
            }
            let 参数 = {
                group_id : event.group_id,
                user_id : 本次QQ,
                duration : mub_time
            };
            //调用
            BOTAPI(ctx, "set_group_ban", 参数);
            有效人数++;
        }
    }
    
    // ================== 二次组装 ==================
    let 返回内容 = `已对【${有效人数}】人有效${mub_ly}啦～`;
    返回内容 += "\n══════════════";
    返回内容 += 组装消息;
    
    // ================== 输出方式 ==================
    if(rs >= 15){
        const messages = [
            { text: 返回内容, name: `[${mub_ly}人数]`, qq: event.self_id }
        ];
        await sendForward(event, messages, ctx);
    }else{
        await sendReply(event, `[CQ:reply,id=${event.message_id}]${返回内容}`, ctx);
    }
    return null;
}




if(message.match(/^(踢出|黑踢)([\s\S]*?)$/)){
    // ================== 授权判断 ==================
    if(RC_sq != "已授权"){
        await sendReply(event, `[CQ:reply,id=${event.message_id}]MK没能量啦～要充电电～～`, ctx);
        return null;
    }
    
    // ================== 最高主人检测 ==================
    const ownerQQs = readB("config.json", "OwnerQQs", []);
    const userQQ = String(event.user_id);
    const isOwner = ownerQQs.includes(userQQ);
    if(!isOwner){
        const nowoner = readB("config.json", "nowoner", false);
        const nowonernr = readB("config.json", "nowonernr", "你不是她......");
        if(nowoner){
            if(nowonernr != ""){
                await sendReply(event, `[CQ:reply,id=${event.message_id}]${nowonernr}`, ctx);
            }
            return null;
        }else{
            return null;
        }
    }
    
    // ================== 获取数值 ==================
    const mub_ly = message.match(/^(踢出|黑踢)([\s\S]*?)$/)[1];//值
    const atUsers = giveAT(event.message);
    const rs = (atUsers.length || 0);//获取艾特人数
    
    // ================== 判断人数 ==================
    if(rs == 0){
        //await sendReply(event, `[CQ:reply,id=${event.message_id}]请要艾特别人发送哦～`, ctx);
        return null;
    }
    
    // ================== 事前准备 ==================
    let 参数188 = {group_id : event.group_id,user_id : event.self_id};
    const dp188 = await BOTAPI(ctx, "get_group_member_info", 参数188);
    let Robot身份 = (RC_group_role[(dp188?.role || "member")] || 0);//机器人身份等级
    if(Robot身份 < 2){
        await sendReply(event, `[CQ:reply,id=${event.message_id}]窝没有群管权限唉～`, ctx);
        return null;
    }
    
    // ================== 获取参数 ==================
    let type = false;
    if(mub_ly == "黑踢"){
        type = true;
    }else{
        type = false;
    }
    
    // ================== 循环 ==================
    let 真实数据 = [];
    let 组装消息 = "";
    let 有效人数 = 0;
    for(let i = 0; i <  rs; i++) {
        let 本次QQ = atUsers[i];
        // ================== 身份验证 ==================
        let 参数199 = {group_id : event.group_id,user_id : 本次QQ};
        let dp199 = await BOTAPI(ctx, "get_group_member_info", 参数199);
        let User身份 = (RC_group_role[(dp199?.role || "member")] || 0);//目标身份
        if(User身份 >= Robot身份){//比机器人大 | 同级
            组装消息 += `\n❌${i+1}.${本次QQ}:权限不足`;
            continue;
        }else{
            // ================== 调用接口 ==================
            if(mub_ly == "踢出"){
                组装消息 += `\n✅${i+1}.${本次QQ}:普通踢出`;
            }else{
                组装消息 += `\n✅${i+1}.${本次QQ}:拉黑踢出`;
            }
            真实数据.push(本次QQ);
            有效人数++;
        }
    }
    
    // ================== 调用接口 ==================
    let 参数 = {
        group_id : event.group_id,
        user_id : 真实数据,
        reject_add_request : type
    };
    BOTAPI(ctx, "set_group_kick_members", 参数);
    
    // ================== 二次组装 ==================
    let 返回内容 = `已对【${有效人数}】人有效${mub_ly}啦～`;
    返回内容 += "\n══════════════";
    返回内容 += 组装消息;
    
    // ================== 输出方式 ==================
    if(rs >= 15){
        const messages = [
            { text: 返回内容, name: `[${mub_ly}人数]`, qq: event.self_id }
        ];
        await sendForward(event, messages, ctx);
    }else{
        await sendReply(event, `[CQ:reply,id=${event.message_id}]${返回内容}`, ctx);
    }
    return null;
}



if(message.match(/^(上管|下管)([\s\S]*?)$/)){
    // ================== 授权判断 ==================
    if(RC_sq != "已授权"){
        await sendReply(event, `[CQ:reply,id=${event.message_id}]MK没能量啦～要充电电～～`, ctx);
        return null;
    }
    
    // ================== 最高主人检测 ==================
    const ownerQQs = readB("config.json", "OwnerQQs", []);
    const userQQ = String(event.user_id);
    const isOwner = ownerQQs.includes(userQQ);
    if(!isOwner){
        const nowoner = readB("config.json", "nowoner", false);
        const nowonernr = readB("config.json", "nowonernr", "你不是她......");
        if(nowoner){
            if(nowonernr != ""){
                await sendReply(event, `[CQ:reply,id=${event.message_id}]${nowonernr}`, ctx);
            }
            return null;
        }else{
            return null;
        }
    }
    
    // ================== 获取数值 ==================
    const mub_ly = message.match(/^(上管|下管)([\s\S]*?)$/)[1];//值
    const atUsers = giveAT(event.message);
    const rs = (atUsers.length || 0);//获取艾特人数
    
    // ================== 判断人数 ==================
    if(rs == 0){
        //await sendReply(event, `[CQ:reply,id=${event.message_id}]请要艾特别人发送哦～`, ctx);
        return null;
    }
    
    // ================== 事前准备 ==================
    let 参数188 = {group_id : event.group_id,user_id : event.self_id};
    const dp188 = await BOTAPI(ctx, "get_group_member_info", 参数188);
    let Robot身份 = (RC_group_role[(dp188?.role || "member")] || 0);//机器人身份等级
    if(Robot身份 != 3){
        await sendReply(event, `[CQ:reply,id=${event.message_id}]窝没有群主权限唉～`, ctx);
        return null;
    }
    
    // ================== 获取参数 ==================
    let type = false;
    if(mub_ly == "上管"){
        type = true;
    }else{
        type = false;
    }
    
    // ================== 循环 ==================
    let 组装消息 = "";
    let 有效人数 = 0;
    for(let i = 0; i <  rs; i++) {
        let 本次QQ = atUsers[i];
        // ================== 身份验证 ==================
        let 参数199 = {group_id : event.group_id,user_id : 本次QQ};
        let dp199 = await BOTAPI(ctx, "get_group_member_info", 参数199);
        let User身份 = (RC_group_role[(dp199?.role || "member")] || 0);//目标身份
        // ================== 类型 ==================
        if(mub_ly == "上管"){
            if(User身份 >= 2){//比机器人大 | 同级
                组装消息 += `\n❌${i+1}.${本次QQ}:已经是啦`;
                continue;
            }else{
                组装消息 += `\n✅${i+1}.${本次QQ}:新上位`;
                有效人数++;
            }
        }else{
            if(User身份 < 2){//比机器人大 | 同级
                组装消息 += `\n❌${i+1}.${本次QQ}:已就不是`;
                continue;
            }else{
                组装消息 += `\n✅${i+1}.${本次QQ}:被下台了`;
                有效人数++;
            }
        }
        // ================== 访问接口 ==================
        let 参数 = {
            group_id : event.group_id,
            user_id : 本次QQ,
            enable : type
        };
        BOTAPI(ctx, "set_group_admin", 参数);
    }
    
    // ================== 二次组装 ==================
    let 返回内容 = `已对【${有效人数}】人有效${mub_ly}啦～`;
    返回内容 += "\n══════════════";
    返回内容 += 组装消息;
    
    // ================== 输出方式 ==================
    if(rs >= 15){
        const messages = [
            { text: 返回内容, name: `[${mub_ly}人数]`, qq: event.self_id }
        ];
        await sendForward(event, messages, ctx);
    }else{
        await sendReply(event, `[CQ:reply,id=${event.message_id}]${返回内容}`, ctx);
    }
    return null;
}


if(message == "获取禁言列表"){
    // ================== 来源 ==================
    if(event.message_type != "group"){
        return null;
    }
    
    // ================== 授权判断 ==================
    if(RC_sq != "已授权"){
        await sendReply(event, `[CQ:reply,id=${event.message_id}]MK没能量啦～要充电电～～`, ctx);
        return null;
    }
    
    // ================== 调用接口 ==================
    let 参数 = {
        group_id : event.group_id
    };
    const dp = await BOTAPI(ctx, "get_group_shut_list", 参数);
    const count =(dp.length || 0);
    
    // ================== 判断 ==================
    if(count == 0){
        await sendReply(event, `[CQ:reply,id=${event.message_id}]没有人被禁言啦～`, ctx);
        return null;
    }
    
    // ================== 循环 ==================
    let 组装消息 = `共有【${count}】人处于禁言状态:`;
    组装消息 += "\n══════════════";
    for(let i = 0; i < count; i++) {
        let QQ = (dp[i]?.uin || "0");
        let 昵称 = (dp[i]?.nick || "");
        let 禁言结束时间 = timeA("y-m-d H:i:s", (dp[i]?.shutUpTime || 0));
        组装消息 += `\n${i+1}.${QQ}(${昵称})`;
        组装消息 += `\n[结束时间]:${禁言结束时间}`;
        if(i+1 == count){
            组装消息 += `\n══════════════`;
        }else{
            组装消息 += `\n-----------------`;
        }
    }
    
    // ================== 输出 ==================
    if(count >= 10){
        const messages = [
            { text: 组装消息, name: "[禁言列表]", qq: event.self_id }
        ];
        await sendForward(event, messages, ctx);
    }else{
        await sendReply(event, `[CQ:reply,id=${event.message_id}]${组装消息}`, ctx);
    }
    return null;
}



















// ================== 娱乐部分 ==================
if(message == "菜单"){
    // ================== 授权判断 ==================
    if(RC_sq != "已授权"){
        await sendReply(event, `[CQ:reply,id=${event.message_id}]MK没能量啦～要充电电～～`, ctx);
        return null;
    }
    // ================== 组装消息 ==================
    let 组装消息 = `══════════════`;
    组装消息 += `\n群管系统 `;
    组装消息 += `\n----------------`;
    组装消息 += `\n银行系统 `;
    组装消息 += `\n══════════════`;
    // ================== 输出 ==================
    await sendReply(event, `[CQ:reply,id=${event.message_id}]${组装消息}`, ctx);
}

if(message == "签到" || message == "打卡"){
    // ================== 授权判断 ==================
    if(RC_sq != "已授权"){
        await sendReply(event, `[CQ:reply,id=${event.message_id}]MK没能量啦～要充电电～～`, ctx);
        return null;
    }
    
    // ================== 读取数据 ==================
    let 今天 = timeA("y-m-d", Math.floor(Date.now() / 1000));
    let 今日人数 = readB("筱筱吖/娱乐系统/签到数据/全服记录数量.json", 今天, 0);
    let 累计次数 = readB("筱筱吖/娱乐系统/签到数据/累计次数.json", event.user_id, 0);
    let 签到状态 = readB("筱筱吖/娱乐系统/签到数据/日期记录/"+今天+"/检测.json", event.user_id, "未知");
    let 签到排名 = readB("筱筱吖/娱乐系统/签到数据/日期记录/"+今天+"/排名.json", event.user_id, "未知");
    let 签到详细时间 = readB("筱筱吖/娱乐系统/签到数据/日期记录/"+今天+"/详细时间.json", event.user_id, "未知");
    
    // ================== 判断是否已打卡 ==================
    if(签到状态 != "未知"){
        let 返回内容 = "❌你今天签到过啦～就算你再怎么发我也不会多给你哒！";
        返回内容 += `\n══════════════`;
        返回内容 += `\n[名次]:${签到排名}`;
        返回内容 += `\n[时间]:${签到详细时间}`;
        返回内容 += `\n[累计]:${累计次数}天`;
        返回内容 += `\n══════════════`;
        await sendReply(event, `[CQ:reply,id=${event.message_id}]${返回内容}`, ctx);
        return null;
    }
    
    // ================== 估算奖励 ==================
    let 名次奖励 = {
        "1" : rand(90, 125),
        "2" : rand(75, 89),
        "3" : rand(50, 74),
        "其他" : rand(15, 49)
    };
    let 本次序号 = 今日人数 + 1;
    let 增加归笺 = 0;
    if(本次序号 <= 3){
        增加归笺 = 名次奖励[本次序号];
    }else{
        增加归笺 = 名次奖励["其他"];
    }
    
    // ================== 先写入 ==================
    let xx_time = timeA("y-m-d H:i:s", Math.floor(Date.now() / 1000));
    let 归笺 = Number(readB("筱筱吖/娱乐系统/游戏数据/归笺.json", event.user_id, 0));
    writeB("筱筱吖/娱乐系统/游戏数据/归笺.json", event.user_id, 归笺 + 增加归笺);
    writeB("筱筱吖/娱乐系统/签到数据/累计次数.json", event.user_id, 累计次数 + 1);
    writeB("筱筱吖/娱乐系统/签到数据/全服记录数量.json", 今天, 本次序号);
    writeB("筱筱吖/娱乐系统/签到数据/日期记录/"+今天+"/检测.json", event.user_id, "已签到");
    writeB("筱筱吖/娱乐系统/签到数据/日期记录/"+今天+"/排名.json", event.user_id, 本次序号);
    writeB("筱筱吖/娱乐系统/签到数据/日期记录/"+今天+"/详细时间.json", event.user_id, xx_time);
    
    // ================== 组装消息 ==================
    let 返回内容 = "✅签到成功啦～！";
    返回内容 += `\n══════════════`;
    返回内容 += `\n[归笺] + ${增加归笺}`;
    返回内容 += `\n------------------------`;
    返回内容 += `\n[名次]:${本次序号}`;
    返回内容 += `\n[时间]:${xx_time}`;
    返回内容 += `\n[累计]:${累计次数 + 1}天`;
    返回内容 += `\n══════════════`;
    
    // ================== 输出 ==================
    await sendReply(event, `[CQ:reply,id=${event.message_id}]${返回内容}`, ctx);
}



if(message == "银行系统"){
    // ================== 授权判断 ==================
    if(RC_sq != "已授权"){
        await sendReply(event, `[CQ:reply,id=${event.message_id}]MK没能量啦～要充电电～～`, ctx);
        return null;
    }
    
    // ================== 组装消息 ==================
    let 返回内容 = `══════════════`;
    返回内容 += `\n存款[数量]`;
    返回内容 += `\n取出[数量]`;
    返回内容 += `\n全部存款 全部取出`;
    返回内容 += `\n══════════════`;
    // ================== 输出 ==================
    await sendReply(event, `[CQ:reply,id=${event.message_id}]${返回内容}`, ctx);
}



if(message.match(/^(全部|)(存款|存入)([0-9]+|)$/)){
    // ================== 授权判断 ==================
    if(RC_sq != "已授权"){
        await sendReply(event, `[CQ:reply,id=${event.message_id}]MK没能量啦～要充电电～～`, ctx);
        return null;
    }
    // ================== 读取数据 ==================
    const one_mub = message.match(/^(全部|)(存款|存入)([0-9]+|)/)[1];
    const three_mub = (message.match(/^(全部|)(存款|存入)([0-9]+|)/)[3] || 0);
    let 归笺 = Number(readB("筱筱吖/娱乐系统/游戏数据/归笺.json", event.user_id, 0));
    let 储存时间 = readB("筱筱吖/娱乐系统/游戏数据/银行系统/储存时间.json", event.user_id, 0);
    let 要存的 = 0;
    
    // ================== 判断 - 1==================
    if(one_mub != "" && three_mub != ""){
        await sendReply(event, `[CQ:reply,id=${event.message_id}]你这样做可不行哦～全部存款时不可以加指定值哦～`, ctx);
        return null;
    }
    if(one_mub == three_mub){//如果两个都是空的
        return null;
    }
    // ================== 判断 - 2 ==================
    if(one_mub == "全部" && three_mub == ""){
        要存的 = 归笺;
    }
    if(one_mub == "" && three_mub != ""){
        要存的 = Number(three_mub);
    }
    if(要存的 > 归笺){
        await sendReply(event, `[CQ:reply,id=${event.message_id}]你现有的归笺好像没有这么多叭～？`, ctx);
        return null;
    }
    if(要存的 == 0){
        await sendReply(event, `[CQ:reply,id=${event.message_id}]你是0吗？`, ctx);
        return null;
    }
    
    // ================== 写入数据 ==================
    let 归笺2 = Number(readB("筱筱吖/娱乐系统/游戏数据/归笺.json", event.user_id, 0));
    let 银行2归笺 = Number(readB("筱筱吖/娱乐系统/游戏数据/银行系统/银行归笺.json", event.user_id, 0));
    writeB("筱筱吖/娱乐系统/游戏数据/归笺.json", event.user_id, 归笺 - 要存的);
    writeB("筱筱吖/娱乐系统/游戏数据/银行系统/银行归笺.json", event.user_id, 银行2归笺 + 要存的);
    if(储存时间 == 0 || 储存时间 == undefined){
        writeB("筱筱吖/娱乐系统/游戏数据/银行系统/储存时间.json", event.user_id, Math.floor(Date.now() / 1000));
    }
    
    // ================== 组装消息 ==================
    let quc = moneyA(要存的);
    let zgg = moneyA(银行2归笺 + 要存的);
    let 返回内容 = ``;
    返回内容 += `存款成功啦～！`;
    返回内容 += `\n══════════════`;
    返回内容 += `\n[存入]:${quc}`;
    返回内容 += `\n[总共]:${zgg}`;
    返回内容 += `\n══════════════`;
    await sendReply(event, `[CQ:reply,id=${event.message_id}]${返回内容}`, ctx);
    return null;
}


if(message.match(/^(全部|)(取出|取款)([0-9]+|)$/)){
    // ================== 授权判断 ==================
    if(RC_sq != "已授权"){
        await sendReply(event, `[CQ:reply,id=${event.message_id}]MK没能量啦～要充电电～～`, ctx);
        return null;
    }
    // ================== 读取数据 ==================
    const one_mub = message.match(/^(全部|)(取出|取款)([0-9]+|)/)[1];
    const three_mub = (message.match(/^(全部|)(取出|取款)([0-9]+|)/)[3] || 0);
    let 储存时间 = readB("筱筱吖/娱乐系统/游戏数据/银行系统/储存时间.json", event.user_id, 0);
    let 银行_归笺 = Number(readB("筱筱吖/娱乐系统/游戏数据/银行系统/银行归笺.json", event.user_id, 0));
    let 要取的 = 0;
    
    // ================== 判断 - 1==================
    if(one_mub != "" && three_mub != ""){
        await sendReply(event, `[CQ:reply,id=${event.message_id}]你这样做可不行哦～全部取款时不可以加指定值哦～`, ctx);
        return null;
    }
    if(one_mub == three_mub){//如果两个都是空的
        return null;
    }
    // ================== 判断 - 2 ==================
    if(one_mub == "全部" && three_mub == ""){
        要取的 = 银行_归笺;
    }
    if(one_mub == "" && three_mub != ""){
        要取的 = Number(three_mub);
    }
    if(储存时间 == 0){
        await sendReply(event, `[CQ:reply,id=${event.message_id}]你好像没有储存过哎～我这里都找不到记录～`, ctx);
        return null;
    }
    if(要取的 > 银行_归笺){
        await sendReply(event, `[CQ:reply,id=${event.message_id}]你好像没有这么多叭～？`, ctx);
        return null;
    }
    if(要取的 == 0){
        await sendReply(event, `[CQ:reply,id=${event.message_id}]你是0吗？`, ctx);
        return null;
    }
    
    // ================== 利润机制 - 时间换算 ==================
    let 总秒数 = Math.floor(Date.now() / 1000) - 储存时间;//获取出储存秒
    let 总小时 = 总秒数 / 3600;//换算小时
    let 总天数 = 总秒数 / 86400;//换算成天数
    if(储存时间 == 0 || 储存时间 == undefined || 总秒数 <= 0){
        await sendReply(event, `[CQ:reply,id=${event.message_id}]储存时间记录异常！`, ctx);
        return null;
    }
    
    // ================== 利润机制 - 利息计算 ==================
    let 换算比例 = 2;//如24小时就砍半=12小时，不砍则1
    let 剩余小时数 = Math.floor(总小时 / 换算比例);
    let 利润 = 0;
    if(剩余小时数 != 0){
        利润 = 银行_归笺 * 剩余小时数 * 0.00025;
        if(总天数 >= 3){
            利润 = 银行_归笺 * 剩余小时数 * 0.0008;
        }
        if(总天数 >= 7){
            利润 = 银行_归笺 * 剩余小时数 * 0.001;
        }
        if(总天数 >= 14){
            利润 = 银行_归笺 * 剩余小时数 * 0.0015;
        }
        if(总天数 >= 30){
            利润 = 银行_归笺 * 剩余小时数 * 0.0019;
        }
        利润 = Math.ceil(利润);
    }else{
        利润 = 0;
    }
    
    // ================== 重新写入数据 ==================
    let 归笺 = Number(readB("筱筱吖/娱乐系统/游戏数据/归笺.json", event.user_id, 0));
    let 银行2归笺 = Number(readB("筱筱吖/娱乐系统/游戏数据/银行系统/银行归笺.json", event.user_id, 0));
    writeB("筱筱吖/娱乐系统/游戏数据/归笺.json", event.user_id, 归笺 + 利润 + 要取的);
    writeB("筱筱吖/娱乐系统/游戏数据/银行系统/银行归笺.json", event.user_id, 银行2归笺 - 要取的);
    writeB("筱筱吖/娱乐系统/游戏数据/银行系统/储存时间.json", event.user_id, Math.floor(Date.now() / 1000));
    
    // ================== 组装消息 ==================
    let hbi = moneyA(利润);
    let quc = moneyA(要取的);
    let 返回内容 = ``;
    返回内容 += `取款成功啦～！`;
    返回内容 += `\n══════════════`;
    返回内容 += `\n[取出]:${quc}`;
    返回内容 += `\n-------------------`;
    返回内容 += `\n[利润]:${hbi}`;
    返回内容 += `\n[时长]:${Number(总小时.toFixed(2))}小时`;
    返回内容 += `\n══════════════`;
    await sendReply(event, `[CQ:reply,id=${event.message_id}]${返回内容}`, ctx);
    return null;
}






if(message.match(/^(获取本群成员|群成员列表)$/)){
    // ================== 来源 ==================
    if(event.message_type != "group"){
        return null;
    }
    
    // ================== 访问接口 ==================
    let 参数 = {
        group_id : event.group_id
    };
    //调用
    const dp = await BOTAPI(ctx, "get_group_member_list", 参数);
    // ================== 循环前置 ==================
    let data = dp;
    let 总人数 = Object.keys(data).length;
    if(总人数 == 0){
        //什么群tm0个人
        await sendReply(event, `[CQ:reply,id=${event.message_id}]获取失败！1`, ctx);
    }
    
    // ================== 循环 ==================
    let 身份数据 = {
        "owner" : "👑",
        "admin" : "⭐",
        "member" : "👤",
        "unknown" : "👤"
    };
    let 组装消息 = `本群共有【${总人数}】人哦:`;
    for(let i = 0; i < 总人数; i++) {
        let 身份 = data[i].role;
        let 是否机器人 = data[i].is_robot;
        if(是否机器人){
            组装消息 += `\n🤖${i+1}.${data[i].nickname}(${data[i].user_id})`;
        }else{
            组装消息 += `\n${身份数据[身份]}${i+1}.${data[i].nickname}(${data[i].user_id})`;
        }
        continue;
    }
    
    // ================== 输出结果 ==================
    if(总人数 >= 15){//合并输出
        const messages = [
            { text: 组装消息, name: "[本群全部人]", qq: event.self_id }
        ];
        await sendForward(event, messages, ctx);
    }else{//普通输出
        await sendReply(event, `[CQ:reply,id=${event.message_id}]内容:${组装消息}`, ctx);
    }
    return null;
}
















// ================== 以下均为主人权限指令 ==================
// 直接拦截了，普通用户不会触发下面的
const ownerQQs = readB("config.json", "OwnerQQs", []);
const userQQ = String(event.user_id);
const isOwner = ownerQQs.includes(userQQ);
if(!isOwner){
    const nowoner = readB("config.json", "nowoner", false);
    const nowonernr = readB("config.json", "nowonernr", "你不是她......");
    if(nowoner){
        return null;
    }else{
        return null;
    }
}


// ================== 事件开关部分 ==================
if(message.match(/^(开启|关闭)(.*|全部事件)$/)){
    // ================== 获取数据 ==================
    const one_mub = message.match(/^(开启|关闭)(.*|全局事件)$/)[1];
    const two_mub = message.match(/^(开启|关闭)(.*|全部事件)$/)[2];
    
    // ================== 判断 ==================
    if(two_mub == "" || two_mub == undefined){
        return null;
    }
    if(!array_shijian.includes(two_mub) && two_mub != "全部事件"){
        return null;
    }
    
    // ================== 授权判断 ==================
    if(RC_sq != "已授权"){
        await sendReply(event, `[CQ:reply,id=${event.message_id}]MK没能量啦～要充电电～～`, ctx);
        return null;
    }
    
    // ================== 判断 ==================
    if(two_mub != "全部事件"){
        let wj_ofu = readB(`筱筱吖/事件系统/${event.group_id}.json`, two_mub, "关闭");
        if(wj_ofu == one_mub){
            await sendReply(event, `[CQ:reply,id=${event.message_id}]这个事件好像也就${wj_ofu}了吧～？`, ctx);
        }else{
            // ================== 正常写入 ==================
            writeB(`筱筱吖/事件系统/${event.group_id}.json`, two_mub, one_mub);
            await sendReply(event, `[CQ:reply,id=${event.message_id}]这就把【${two_mub}】给${one_mub}！`, ctx);
        }
        return null;
    }else{
        let 次数 = (array_shijian.length || 0);
        let 组装消息 = `已将以下事件同意「${one_mub}」`;
        组装消息 += `\n══════════════`;
        for(let i = 0; i < 次数; i++) {
            let wj_of = readB(`筱筱吖/事件系统/${event.group_id}.json`, array_shijian[i], "关闭");
            if(wj_of == one_mub){
                组装消息 += `\n【${array_shijian[i]}】: 本就${wj_of}！`;
            }else{
                组装消息 += `\n【${array_shijian[i]}】: 已${one_mub}！`;
                writeB(`筱筱吖/事件系统/${event.group_id}.json`, array_shijian[i], one_mub);
            }
        }
        // ================== 输出 ==================
        await sendReply(event, `[CQ:reply,id=${event.message_id}]${组装消息}`, ctx);
        return null;
    }
}




if(message.match(/^(增加|新增|添加|删除|取消|减少|清空)审核条件([\s\S]*)$/)){
    // ================== 来源 ==================
    if(event.message_type != "group"){
        return null;
    }
    // ================== 授权判断 ==================
    if(RC_sq != "已授权"){
        await sendReply(event, `[CQ:reply,id=${event.message_id}]MK没能量啦～要充电电～～`, ctx);
        return null;
    }
    
    // ================== 获取数据 ==================
    const one_mub = message.match(/^(增加|新增|添加|删除|取消|减少|清空)审核条件([\s\S]*)$/)[1];
    const two_mub = message.match(/^(增加|新增|添加|删除|取消|减少|清空)审核条件([\s\S]*)$/)[2];
    let wj_cc = JSON.parse(readA(`筱筱吖/群管系统/入群审核/${event.group_id}/条件库.json`) || []);
    let 包含 = wj_cc.includes(two_mub);
    
    // ================== 添加 ==================
    if(one_mub == "增加" || one_mub == "新增" || one_mub == "添加"){
        if(包含 == true){
            await sendReply(event, `[CQ:reply,id=${event.message_id}]emmmm，介个好像也就有了哎～`, ctx);
            return null;
        }
        //正常写入
        wj_cc.push(two_mub);
        writeA(`筱筱吖/群管系统/入群审核/${event.group_id}/条件库.json`, JSON.stringify(wj_cc));
        await sendReply(event, `[CQ:reply,id=${event.message_id}]我这就去更新条件\n【新增】: ${two_mub}`, ctx);
        return null;
    }
    // ================== 删除 ==================
    if(one_mub == "删除" || one_mub == "取消" || one_mub == "减少"){
        if(包含 == false){
            await sendReply(event, `[CQ:reply,id=${event.message_id}]额，介个好像没有吧，我都找不到～～`, ctx);
            return null;
        }
        //正常删除
        let arr = wj_cc;
        arr = arr.filter(item => item !== two_mub);
        writeA(`筱筱吖/群管系统/入群审核/${event.group_id}/条件库.json`, JSON.stringify(arr));
        await sendReply(event, `[CQ:reply,id=${event.message_id}]我这就去更新条件\n【删除】: ${two_mub}`, ctx);
        return null;
    }
    // ================== 清空 ==================
    if(one_mub == "清空"){
        writeA(`筱筱吖/群管系统/入群审核/${event.group_id}/条件库.json`, "[]");
        await sendReply(event, `[CQ:reply,id=${event.message_id}]耗的，这就就把条件通通删除！`, ctx);
        return null;
    }
}



if(message.match(/^设置入群审核字数数量([0-9]+)$/)){
    // ================== 来源 ==================
    if(event.message_type != "group"){
        return null;
    }
    // ================== 授权判断 ==================
    if(RC_sq != "已授权"){
        await sendReply(event, `[CQ:reply,id=${event.message_id}]MK没能量啦～要充电电～～`, ctx);
        return null;
    }
    
    // ================== 获取数据 ==================
    const one_mub = message.match(/^设置入群审核字数数量([0-9]+)$/)[1];
    let cc = Number(one_mub);
    let wj_cc = Number(readB(`筱筱吖/群管系统/入群审核/${event.group_id}/数据.json`, "字数数量", 5));
    
    // ================== 匹配判断 ==================
    if(cc == wj_cc){
        await sendReply(event, `[CQ:reply,id=${event.message_id}]跟原来的次数一样啦～！`, ctx);
        return null;
    }
    if(cc == 0 || cc > 15){
        await sendReply(event, `[CQ:reply,id=${event.message_id}]你这数字真的合适嘛～？`, ctx);
        return null;
    }
    
    // ================== 写入&组装 ==================
    writeB(`筱筱吖/群管系统/入群审核/${event.group_id}/数据.json`, "字数数量", cc);
    let 返回内容 = `已把本群的入群审核【字数审核】设置为${one_mub}字`;
    返回内容 += `\n══════════════`;
    返回内容 += `\n记得本账号要有管理权限并且群聊是要为「发送验证消息」才生效哦～`;
    // ================== 输出 ==================
    await sendReply(event, `[CQ:reply,id=${event.message_id}]${返回内容}`, ctx);
}




if(message.match(/^设置入群审核条件(准确|模糊多重|准确多重|包含|字数)$/)){
    // ================== 来源 ==================
    if(event.message_type != "group"){
        return null;
    }
    // ================== 授权判断 ==================
    if(RC_sq != "已授权"){
        await sendReply(event, `[CQ:reply,id=${event.message_id}]MK没能量啦～要充电电～～`, ctx);
        return null;
    }
    
    // ================== 获取数据 ==================
    const one_mub = message.match(/^设置入群审核条件(准确|模糊多重|准确多重|包含|字数)$/)[1];
    let wj_cc = readB(`筱筱吖/群管系统/入群审核/${event.group_id}/数据.json`, "条件", "字数");
    
    // ================== 判断 ==================
    if(one_mub == wj_cc){
        await sendReply(event, `[CQ:reply,id=${event.message_id}]目前本群设置的条件是一样的啦～！`, ctx);
        return null;
    }
    
    // ================== 写入&组装 ==================
    writeB(`筱筱吖/群管系统/入群审核/${event.group_id}/数据.json`, "条件", one_mub);
    let 返回内容 = `已把本群的入群审核【条件】设置为「${one_mub}」模式`;
    返回内容 += `\n══════════════`;
    返回内容 += `\n记得本账号要有管理权限并且群聊是要为「发送验证消息」才生效哦～`;
    // ================== 输出 ==================
    await sendReply(event, `[CQ:reply,id=${event.message_id}]${返回内容}`, ctx);
}


if(message.match(/^设置入群审核答案([\s\S]*)/)){
    // ================== 来源 ==================
    if(event.message_type != "group"){
        return null;
    }
    // ================== 授权判断 ==================
    if(RC_sq != "已授权"){
        await sendReply(event, `[CQ:reply,id=${event.message_id}]MK没能量啦～要充电电～～`, ctx);
        return null;
    }
    
    const one_mub = message.match(/^设置入群审核答案([\s\S]*)/)[1];
    // ================== 写入&组装 ==================
    writeB(`筱筱吖/群管系统/入群审核/${event.group_id}/数据.json`, "答案", one_mub);
    let 返回内容 = `已把本群的入群审核【答案】设置为${one_mub}`;
    返回内容 += `\n══════════════`;
    返回内容 += `\n记得本账号要有管理权限并且群聊是要为「发送验证消息」才生效哦～`;
    // ================== 输出 ==================
    await sendReply(event, `[CQ:reply,id=${event.message_id}]${返回内容}`, ctx);
}


if(message.match(/^设置入群审核单日次数([0-9]+)$/)){
    // ================== 来源 ==================
    if(event.message_type != "group"){
        return null;
    }
    // ================== 授权判断 ==================
    if(RC_sq != "已授权"){
        await sendReply(event, `[CQ:reply,id=${event.message_id}]MK没能量啦～要充电电～～`, ctx);
        return null;
    }
    
    // ================== 获取数据 ==================
    const one_mub = message.match(/^设置入群审核单日次数([0-9]+)$/)[1];
    let cc = Number(one_mub);
    let wj_cc = Number(readB(`筱筱吖/群管系统/入群审核/${event.group_id}/数据.json`, "次数", 3));
    
    // ================== 匹配判断 ==================
    if(cc == wj_cc){
        await sendReply(event, `[CQ:reply,id=${event.message_id}]跟原来的次数一样啦～！`, ctx);
        return null;
    }
    if(cc == 0 || cc > 100){
        await sendReply(event, `[CQ:reply,id=${event.message_id}]你这数字真的合适嘛～？`, ctx);
        return null;
    }
    
    // ================== 写入&组装 ==================
    writeB(`筱筱吖/群管系统/入群审核/${event.group_id}/数据.json`, "次数", cc);
    let 返回内容 = `已把本群的入群审核【每日次数】设置为${one_mub}次`;
    返回内容 += `\n══════════════`;
    返回内容 += `\n记得本账号要有管理权限并且群聊是要为「发送验证消息」才生效哦～`;
    // ================== 输出 ==================
    await sendReply(event, `[CQ:reply,id=${event.message_id}]${返回内容}`, ctx);
}


if(message == "查看多重条件列表"){
    // ================== 来源 ==================
    if(event.message_type != "group"){
        return null;
    }
    // ================== 授权判断 ==================
    if(RC_sq != "已授权"){
        await sendReply(event, `[CQ:reply,id=${event.message_id}]MK没能量啦～要充电电～～`, ctx);
        return null;
    }
    
    // ================== 读取数据 ==================
    let 数据 = JSON.parse(readA(`筱筱吖/群管系统/入群审核/${event.group_id}/条件库.json`, []));
    let 数据数量 = 数据.length;
    
    // ================== 循环前置 ==================
    if(数据数量 == 0){
        await sendReply(event, `[CQ:reply,id=${event.message_id}]窝好像没有获取到数据哎～`, ctx);
        return null;
    }
    // ================== 循环 ==================
    let 组装消息 = `本群共有【${数据数量}】个条件`;
    组装消息 += `\n══════════════`;
    for(let i = 0; i < 数据数量; i++) {
        let 本次键 = 数据[i];
        组装消息 += `\n【${i + 1}】${本次键}`;
    }
    await sendReply(event, `[CQ:reply,id=${event.message_id}]${组装消息}`, ctx);
}










}



// 【定时任务】
export async function handleScheduledTask(ctx) {
  const now = new Date();
  const timeStr = now.toTimeString().split(" ")[0];  // HH:mm:ss
  
  // 示例：执行
  if (timeStr === "11:46:00") {
    await sendReply({ message_type: "group", group_id: "101311160" }, "22222", ctx);
    // 可以在这里添加你的定时任务逻辑
  }
}

















// 【通知事件处理】
export async function handleNotice(event, ctx) {
    const noticeType = event.notice_type;
    
// ================== 全局开关 - 群聊 ==================
const group_ofs = readB("config.json", "group_of", []);
const hdhbedk = String(event.group_id);
const isGroups = group_ofs.includes(hdhbedk);
if(!isGroups){
    return null;
}

// ================== 群号检测 ==================
if (event.group_id !== 101311160 && event.group_id !== 1082631686) {
    return null;
}
    

// ================== 群禁言事件处理 ==================
if(noticeType === "group_ban") {
    const userId = event.user_id;//用户QQ
    const groupId = event.group_id;//群号
    const duration = event.duration;//时长(秒)
    const subType = event.sub_type; //"ban" 禁言, "lift_ban" 解除禁言
    // ================== 输出 ==================
    let fakeEvent = {message_type: "group", group_id: event.group_id};
    if(event.sub_type == "ban"){
        let 返回内容 = `${event.user_id}被禁言了【${event.duration}】秒哎～他又不说话了，你总是这样....`;
        await sendReply(fakeEvent, 返回内容, ctx);
    }else{
        let 返回内容 = `${event.user_id}被解禁了哎～他又可以说话了！`;
        await sendReply(fakeEvent, 返回内容, ctx);
    }
    return null;
}










}


// 【请求事件处理】
export async function handleRequest(event, ctx) {
    const requestType = event.request_type;

//获取授权状态 
let dir_wj_time = "";
if (event.group_id) {
    dir_wj_time = "筱筱吖/授权系统/授权信息/" + event.group_id + ".json";
} else {
    dir_wj_time = "筱筱吖/授权系统/授权信息/私聊.json";
}
//
const xz_time = Math.floor(Date.now() / 1000);
const wj_time = readB(dir_wj_time, "授权时间", 0);
const wj_km_time = readB(dir_wj_time, "卡密时长", 0);
const jjjj = xz_time - wj_time;
//
let RC_sq = "未授权";
if (wj_time !== 0 && wj_km_time !== 0 && jjjj <= wj_km_time) {
    RC_sq = "已授权";
}
//获取授权状态 


// ================== 全局开关 - 群聊 ==================
const group_ofs = readB("config.json", "group_of", []);
const hdhbedk = String(event.group_id);
const isGroups = group_ofs.includes(hdhbedk);
if(!isGroups){
    return null;
}


// ================== 授权判断 ==================
if(RC_sq != "已授权"){
    return null;
}





// ================== 加群申请 ==================
if (requestType === "group") {
    // ================== 获取问题数据 ==================
    let 问题 = "";
    let 答案 = "";
    let text = (event?.comment || "");
    let 今天 = timeA("y-m-d", Math.floor(Date.now() / 1000));
    let wj_tj = readB(`筱筱吖/群管系统/入群审核/${event.group_id}/数据.json`, "条件", "字数");
    let wj_cs = Number(readB(`筱筱吖/群管系统/入群审核/${event.group_id}/数据.json`, "次数", 3));
    let wj_zs = Number(readB(`筱筱吖/群管系统/入群审核/${event.group_id}/数据.json`, "字数数量", 5));
    let me_cs = Number(readB(`筱筱吖/群管系统/入群审核/${event.group_id}/申请次数/${event.user_id}.json`, 今天, 0));
    let wj_ofu = readB(`筱筱吖/事件系统/${event.group_id}.json`, "入群验证", "关闭");
    // ================== 管你这那的，出去 ==================
    if(wj_ofu == "关闭"){
        return null;
    }
    if(me_cs > wj_cs){
        // ================== 调用接口 ==================
        let 参数 = {flag : event?.flag, approve : false, reason : "你今天的可用申请次数已用完咯～"};
        await BOTAPI(ctx, "set_group_add_request", 参数);
        return null;
    }
    writeB(`筱筱吖/群管系统/入群审核/${event.group_id}/申请次数/${event.user_id}.json`, 今天, me_cs + 1);
    
    // ================== 获取数据 ==================
    const match = text.match(/问题：([\s\S]*)\n答案：([\s\S]*)/);
    if (match) {
        const question = match[1];
        const answer = match[2];
        问题 = ("问题:", question);
        答案 = ("答案:", answer);
    }
    if(答案 == ""){
        答案 = event.comment;
    }
    
    // ================== 判断内容 ==================
    let 成功与否 = false;
    let 参数 = {flag : event?.flag, approve : false, reason : "意想不到的回复"};
    // ================== 字数验证 ==================
    if(wj_tj == "字数"){
        let 答案字数 = (答案.length || 0);
        if(答案字数 < wj_zs){
            参数 = {flag : event?.flag, approve : false, reason : `本群设定通过内容为:>=${wj_zs}个字`};
        }else{
            参数 = {flag : event?.flag, approve : true};
        }
    }
    
    // ================== 普通答案验证 ==================
    let 普通答案 = readB(`筱筱吖/群管系统/入群审核/${event.group_id}/数据.json`, "答案", "");
    let 普通答案包含 = 答案.includes(普通答案);
    if(wj_tj == "包含"){
        if(普通答案包含 == false){
            参数 = {flag : event?.flag, approve : false, reason : "你的回答不符合本群设定！1"};
        }else{
            成功与否 = true;
            参数 = {flag : event?.flag, approve : true};
        }
    }
    if(wj_tj == "准确"){
        if(答案 === 普通答案){
            成功与否 = true;
            参数 = {flag : event?.flag, approve : true};
        }else{
            参数 = {flag : event?.flag, approve : false, reason : "你的回答不符合本群设定！2"};
        }
    }
    
    // ================== 高级条件验证 ==================
    let wj_cc = JSON.parse(readA(`筱筱吖/群管系统/入群审核/${event.group_id}/条件库.json`) || []);
    let 条件数量 = wj_cc.length;
    if(wj_tj == "模糊多重"){
        for(let i = 0; i < 条件数量; i++) {
            let 本次键 = wj_cc[i];
            if(答案.includes(本次键) == true){
                成功与否 = true;
                参数 = {flag : event?.flag, approve : true};
                break;
            }else{
                参数 = {flag : event?.flag, approve : false, reason : "你的回答不符合本群设定！3"};
            }
        }
    }
    if(wj_tj == "准确多重"){
        for(let i = 0; i < 条件数量; i++) {
            let 本次键 = wj_cc[i];
            if(答案 === 本次键){
                成功与否 = true;
                参数 = {flag : event?.flag, approve : true};
                break;
            }else{
                参数 = {flag : event?.flag, approve : false, reason : "你的回答不符合本群设定！4"};
            }
        }
    }
    // ================== 访问接口 ==================
    BOTAPI(ctx, "set_group_add_request", 参数);
    
    // ================== 组装消息 ==================
    let fakeEvent = {message_type: "group", group_id: event.group_id};//消息指导到触发群聊
    // ================== 输出 ==================
    if(成功与否 == true){//成功
        await sendReply(fakeEvent, `QQ(${event.user_id})通过入群审核，已同意进入～`, ctx);
    }else{//失败
        //await sendReply(fakeEvent, `QQ(${event.user_id})想加入群聊，但回答的问题不符合条件！`, ctx);//调试的
    }
    //await sendReply(fakeEvent, `[条件]:${wj_tj}\n[数据]:${wj_cc}\n[数量]:${条件数量}\n[答案]:${答案}\n[状态]:${成功与否}\n[参数]:${JSON.stringify(参数)}`, ctx);//调试的
    return null;
}





}
