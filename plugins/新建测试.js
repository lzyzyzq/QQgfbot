module.exports={
  async onMessage(ctx){ return "hi from 新建测试" }
}
;module.exports.manifest = Object.assign({}, (typeof module.exports === 'object' && module.exports) || {}, { id: 'pending', name: "新建测试", version: "3.1.0", author: "张三", description: "简介测试" });
