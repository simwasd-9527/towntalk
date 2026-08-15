/**
 * ============================================================
 *  萍水镇 · 极简文字冒险 —— 游戏逻辑
 * ------------------------------------------------------------
 *  核心设计：
 *   1. 所有指令（动作 + 对象）都通过屏幕下方的按钮完成，无需键盘输入。
 *   2. 按钮是“动态”的：脚本根据当前游戏状态（所在房间、出口、房间物品、
 *      静态物体、背包内容）实时计算并渲染可用按钮。
 *      - 例：某房间只有一个出口时，“移动”动作下只会出现一个方向按钮。
 *      - 例：房间没有可拾取物品时，“拾取”动作按钮根本不会出现。
 *      - 例：木箱被打开后，“打开”动作按钮自动消失。
 *   3. 交互分两级：先点“动作（谓语）”，再点“对象（宾语）”。
 *      某些无需对象的动作（如“背包”）点一下即直接执行。
 * ============================================================
 */
"use strict";

/* ============================================================
 * 一、DOM 元素引用
 * ============================================================ */
const outputEl = document.getElementById("output"); // 输出窗口
const hintEl = document.getElementById("hint"); // 提示行
const verbRowEl = document.getElementById("verb-row"); // 动作（谓语）按钮区
const objectRowEl = document.getElementById("object-row"); // 对象（宾语）按钮区

/* ============================================================
 * 二、游戏数据：地点（房间）
 * ------------------------------------------------------------
 * 每个地点是一个对象，字段说明：
 *   name   地点名称（显示用）
 *   desc   地点描述（可含 \n 换行）
 *   exits  出口表 { 方向: 目标地点ID }，用于动态生成“移动”的方向按钮
 *   items  该地点可拾取的物品数组，用于动态生成“拾取”按钮
 *   props  该地点可交互的静态物体（不可拾取，如“旧木箱”），
 *          结构：{ 物体名: { desc, locked, unlockItem, contains } }
 *            desc       查看该物体时显示的描述
 *            locked     是否上锁（true 则需要 unlockItem 才能打开）
 *            unlockItem 打开所需物品名（null 表示无需钥匙）
 *            contains   打开后获得的物品名（null 表示已空/无物品）
 * ============================================================ */
const locations = {
  town_square: {
    name: "萍水镇广场",
    desc: "你站在萍水镇的中心广场，青石板路延伸向四方。\n镇口老槐树沙沙作响，远处炊烟袅袅。",
    exits: { 北: "north_gate", 南: "south_street", 东: "east_market", 西: "west_well" },
    items: ["地图", "干粮"],
    props: {},
  },
  north_gate: {
    name: "北门",
    desc: "萍水镇北门，厚重的木门半掩，门缝透出田野气息。",
    // 只有一个出口 → “移动”只会出现一个方向按钮（动态指令的直观体现）
    exits: { 南: "town_square" },
    items: ["长矛"],
    props: {},
  },
  south_street: {
    name: "南街",
    desc: "萍水镇南街，两旁矮旧木屋，街角有一口古井。",
    exits: { 北: "town_square", 西: "old_house" },
    items: ["铜钱", "旧钥匙"], // “旧钥匙”用于打开老屋里的木箱
    props: {},
  },
  east_market: {
    name: "东市",
    desc: "东市零星摊位，布摊和铁匠铺显得冷清。",
    exits: { 西: "town_square" },
    items: ["布匹", "铁钉"],
    props: {},
  },
  west_well: {
    name: "西井",
    desc: "西边老井，井水清澈，歪脖子柳树垂荫。",
    exits: { 东: "town_square" },
    items: ["水囊"],
    props: {},
  },
  old_house: {
    name: "废弃老屋",
    desc: "破败木屋，屋顶漏光，墙角有个旧木箱。",
    exits: { 东: "south_street" },
    items: ["蜡烛"],
    props: {
      旧木箱: {
        desc: "一个落满灰尘的旧木箱，锁扣上挂着一把锈锁。",
        locked: true,
        unlockItem: "旧钥匙",
        contains: "传家宝", // 打开后获得的胜利物品
      },
    },
  },
};

/* ============================================================
 * 玩家状态
 * ============================================================ */
const player = {
  location: "town_square", // 当前所在地点ID
  inventory: [], // 背包（已拾取的物品列表）
};

/* 达成胜利所需拾取的目标物品 */
const GOAL_ITEM = "传家宝";

/* 游戏是否已结束（胜利后为 true，用于禁用按钮） */
let gameOver = false;

/* 当前选中的动作（谓语）；null 表示尚未选择 */
let selectedVerb = null;

/* ============================================================
 * 三、输出函数：把文本打印到输出窗口
 * ============================================================ */

/**
 * 打印一段文本（支持 \n 换行），可指定颜色类名。
 * @param {string} text 要打印的文本
 * @param {string} className 颜色类名（sys-msg / act-msg / err-msg / emph-msg）
 */
function printMsg(text, className = "") {
  if (text == null) return;
  // 按换行拆成多行，逐行追加到输出窗口
  const lines = String(text).split("\n");
  for (const line of lines) {
    const span = document.createElement("span");
    span.textContent = line;
    if (className) span.className = className;
    outputEl.appendChild(span);
    outputEl.appendChild(document.createElement("br"));
  }
  // 自动滚动到最新内容
  outputEl.scrollTop = outputEl.scrollHeight;
}

/* 以下是对不同消息类型的便捷封装，用不同颜色区分信息类别 */
function printSystem(msg) {
  printMsg("> " + msg, "sys-msg"); // 系统提示
}
function printAction(msg) {
  printMsg("※ " + msg, "act-msg"); // 玩家动作
}
function printError(msg) {
  printMsg("⚠ " + msg, "err-msg"); // 错误提示
}
function printEmph(msg) {
  printMsg("✦ " + msg, "emph-msg"); // 重点信息（地点名、胜利等）
}

/* ============================================================
 * 四、游戏动作（由动态按钮调用）
 * ============================================================ */

/** 返回玩家当前所在的地点对象 */
function currentRoom() {
  return locations[player.location];
}

/** 查看周围环境：显示房间名称、描述、物品、静态物体、出口 */
function lookAround() {
  const loc = currentRoom();
  if (!loc) {
    printError("地点丢失");
    return;
  }

  printEmph(`【${loc.name}】`);
  printMsg(loc.desc);

  // 可拾取物品
  if (loc.items.length > 0) {
    printAction(`可拾取: ${loc.items.join("、")}`);
  } else {
    printMsg("这里空无一物。");
  }

  // 静态物体（如旧木箱）
  const propNames = Object.keys(loc.props);
  if (propNames.length > 0) {
    printMsg(`这里有: ${propNames.join("、")}`);
  }

  // 出口方向
  const exitNames = Object.keys(loc.exits);
  if (exitNames.length > 0) {
    printSystem(`出口: ${exitNames.join("、")}`);
  } else {
    printSystem("没有出口。");
  }

  printMsg("─".repeat(26), "sys-msg"); // 分隔线，便于阅读
}

/** 查看自己 */
function lookSelf() {
  printAction("你打量了一下自己：衣着朴素，精神尚可。");
}

/** 查看指定物品（在背包或当前房间中） */
function lookAtItem(name) {
  const inBag = player.inventory.some((it) => it === name);
  const inRoom = currentRoom().items.some((it) => it === name);
  if (inBag) {
    printAction(`你从背包里拿出「${name}」仔细端详。`);
  } else if (inRoom) {
    printAction(`你观察了一下地上的「${name}」。`);
  } else {
    printError(`你找不到「${name}」。`);
  }
}

/** 查看指定静态物体 */
function lookAtProp(name) {
  const prop = currentRoom().props[name];
  if (!prop) {
    printError(`这里没有「${name}」。`);
    return;
  }
  printAction(`你打量着「${name}」：${prop.desc}`);
  if (prop.locked) printSystem("它被锁着。");
}

/**
 * 移动玩家到指定方向。
 * @param {string} direction 方向（北/南/东/西）
 */
function movePlayer(direction) {
  const loc = currentRoom();
  const targetId = loc.exits[direction];
  // 方向不存在或目标地点未定义 → 报错
  if (!targetId || !locations[targetId]) {
    printError(`「${direction}」方向不通。`);
    return;
  }
  player.location = targetId;
  printAction(`你向${direction}走去……`);
  lookAround(); // 到达后自动查看新房间
}

/**
 * 拾取指定物品。
 * @param {string} name 物品名称
 */
function takeItem(name) {
  const loc = currentRoom();
  const idx = loc.items.indexOf(name);
  if (idx === -1) {
    printError(`这里没有「${name}」。`);
    return;
  }
  // 从房间移除，加入背包
  loc.items.splice(idx, 1);
  player.inventory.push(name);
  printAction(`你捡起「${name}」。`);
  printSystem(`[背包] ${player.inventory.join("、")}`);

  // 拾取目标物品 → 达成胜利
  if (name === GOAL_ITEM) victory();
}

/**
 * 打开指定静态物体（可能上锁）。
 * @param {string} name 物体名称
 */
function openProp(name) {
  const loc = currentRoom();
  const prop = loc.props[name];
  if (!prop) {
    printError(`这里没有「${name}」。`);
    return;
  }

  // 已打开过（contains 为 null 表示里面已空）
  if (prop.contains === null) {
    printMsg(`「${name}」已经打开过了。`);
    return;
  }

  // 上锁检查
  if (prop.locked) {
    // 需要钥匙但背包里没有 → 提示并返回
    if (prop.unlockItem && !player.inventory.includes(prop.unlockItem)) {
      printError(`「${name}」锁着，需要「${prop.unlockItem}」。`);
      return;
    }
    prop.locked = false; // 解锁
    printAction(`你用「${prop.unlockItem}」打开了「${name}」。`);
  } else {
    printAction(`你打开了「${name}」。`);
  }

  // 取出里面的物品并加入背包
  const reward = prop.contains;
  prop.contains = null; // 标记为已取出
  player.inventory.push(reward);
  printAction(`你在里面发现了「${reward}」！`);
  printSystem(`[背包] ${player.inventory.join("、")}`);

  if (reward === GOAL_ITEM) victory();
}

/** 查看背包 */
function showInventory() {
  if (player.inventory.length === 0) {
    printMsg("背包空空如也。");
  } else {
    printAction(`携带: ${player.inventory.join("、")}`);
  }
}

/** 胜利结算 */
function victory() {
  gameOver = true; // 结束游戏，禁用后续动作
  selectedVerb = null;
  printEmph("━".repeat(26));
  printEmph("恭喜！你找回了传家宝，萍水镇恢复了往日的安宁。");
  printEmph("游戏结束，刷新页面可重新开始。");
  printEmph("━".repeat(26));
  refreshButtons();
}

/* ============================================================
 * 五、动态指令系统（核心）
 * ------------------------------------------------------------
 * 每一个“动作”是一个描述对象：
 *   id          动作唯一标识
 *   label       按钮上显示的文字（谓语）
 *   isAvailable 返回布尔值：当前状态下该动作按钮是否应该出现
 *   getTargets  返回“对象（宾语）按钮”列表，每项为 { label, run }
 *   run         可选：若动作无需对象，则提供 run 函数，
 *               点击动作按钮时立即执行（如“背包”）
 *
 * 渲染流程（见第六部分）：
 *   1. renderVerbs() 遍历 ACTIONS，过滤出 isAvailable() 为真的动作，
 *      生成“动作按钮”放入 verb-row。
 *   2. 点击动作按钮：
 *        - 若动作有 run（无需对象）→ 直接执行；
 *        - 否则设为 selectedVerb，并调用 renderTargets() 生成“对象按钮”
 *          放入 object-row（对象由 getTargets() 动态计算）。
 *   3. 点击对象按钮 → 执行对应 run()，然后刷新按钮。
 *
 * 因此按钮完全由当前游戏状态动态决定，而不是写死在 HTML 中。
 * ============================================================ */
const ACTIONS = [
  {
    id: "look",
    label: "查看",
    // 查看随时可用
    isAvailable: () => true,
    // 对象按钮 = 基础对象（周围/自己） + 房间物品 + 房间静态物体
    getTargets: () => {
      const targets = [
        { label: "周围", run: lookAround },
        { label: "自己", run: lookSelf },
      ];
      const loc = currentRoom();
      // 房间内可拾取物品 → 可查看
      for (const item of loc.items) {
        targets.push({ label: item, run: () => lookAtItem(item) });
      }
      // 房间内静态物体 → 可查看
      for (const name of Object.keys(loc.props)) {
        targets.push({ label: name, run: () => lookAtProp(name) });
      }
      return targets;
    },
  },
  {
    id: "move",
    label: "移动",
    // 有出口才显示“移动”按钮
    isAvailable: () => Object.keys(currentRoom().exits).length > 0,
    // 每个出口方向生成一个按钮 —— 出口只有一个时，就只有一个方向按钮
    getTargets: () =>
      Object.keys(currentRoom().exits).map((dir) => ({
        label: dir,
        run: () => movePlayer(dir),
      })),
  },
  {
    id: "take",
    label: "拾取",
    // 房间里有物品才显示“拾取”按钮
    isAvailable: () => currentRoom().items.length > 0,
    getTargets: () =>
      currentRoom().items.map((item) => ({
        label: item,
        run: () => takeItem(item),
      })),
  },
  {
    id: "open",
    label: "打开",
    // 房间里有“尚未打开”的物体才显示“打开”按钮
    isAvailable: () =>
      Object.keys(currentRoom().props).some(
        (name) => currentRoom().props[name].contains !== null,
      ),
    getTargets: () =>
      Object.keys(currentRoom().props)
        .filter((name) => currentRoom().props[name].contains !== null)
        .map((name) => ({ label: name, run: () => openProp(name) })),
  },
  {
    id: "bag",
    label: "背包",
    isAvailable: () => true,
    // 无需对象：run 直接执行（点一下动作按钮就查看背包）
    run: showInventory,
  },
];

/* ============================================================
 * 六、按钮渲染
 * ============================================================ */

/**
 * 创建一个通用按钮，并绑定点击回调。
 * @param {string} label 按钮文字
 * @param {Function} onClick 点击回调
 * @returns {HTMLButtonElement}
 */
function createButton(label, onClick) {
  const btn = document.createElement("button");
  btn.textContent = label;
  btn.addEventListener("click", onClick);
  return btn;
}

/** 渲染“动作（谓语）按钮”行 */
function renderVerbs() {
  verbRowEl.innerHTML = "";

  // 游戏结束后不再显示任何动作按钮
  if (gameOver) return;

  // 过滤出当前状态可用的动作
  const available = ACTIONS.filter((action) => action.isAvailable());

  for (const action of available) {
    const btn = createButton(action.label, () => handleVerbClick(action));
    // 给当前选中的动作按钮加高亮
    if (selectedVerb && selectedVerb.id === action.id) {
      btn.classList.add("selected");
    }
    verbRowEl.appendChild(btn);
  }
}

/**
 * 处理点击动作按钮：
 * - 无需对象的动作 → 直接执行；
 * - 需要对象的动作 → 设为选中（再点一次取消选中），并渲染对象按钮。
 */
function handleVerbClick(action) {
  // 动作自带 run（无需对象）→ 直接执行
  if (typeof action.run === "function") {
    action.run();
    refreshButtons();
    return;
  }

  // 需要对象：切换选中状态
  if (selectedVerb && selectedVerb.id === action.id) {
    selectedVerb = null; // 再点一次同一动作 → 取消选择
  } else {
    selectedVerb = action;
  }
  refreshButtons();
}

/** 渲染“对象（宾语）按钮”行 */
function renderTargets() {
  objectRowEl.innerHTML = "";

  // 未选中动作或游戏结束 → 清空对象按钮
  if (!selectedVerb || gameOver) return;

  // 调用 getTargets() 动态计算当前可选对象
  const targets = selectedVerb.getTargets();

  for (const target of targets) {
    const btn = createButton(target.label, () => {
      target.run(); // 执行该对象对应的动作
      refreshButtons(); // 状态可能已变化，刷新全部按钮
    });
    objectRowEl.appendChild(btn);
  }
}

/** 更新提示行 */
function updateHint() {
  if (gameOver) {
    hintEl.textContent = "游戏已结束，刷新页面可重新开始。";
  } else if (selectedVerb) {
    hintEl.textContent = `已选「${selectedVerb.label}」→ 请选择对象`;
  } else {
    hintEl.textContent = "请选择动作";
  }
}

/**
 * 统一刷新：校验选中态 → 渲染动作与对象按钮 → 更新提示。
 * 每次游戏状态变化（移动/拾取/打开等）后都应调用一次。
 */
function refreshButtons() {
  // 若选中的动作在当前状态下已不可用（例如拾取完物品后“拾取”消失），
  // 则自动取消选中，避免出现悬空的高亮按钮。
  if (selectedVerb && !selectedVerb.isAvailable()) {
    selectedVerb = null;
  }
  renderVerbs();
  renderTargets();
  updateHint();
}

/* ============================================================
 * 七、游戏初始化
 * ============================================================ */
function initGame() {
  outputEl.innerHTML = "";
  printEmph("☯ 萍水镇 · 极简文字冒险 ☯");
  printMsg("所有操作都通过下方按钮完成。");
  printMsg(`目标：找回遗失的「${GOAL_ITEM}」。`);
  printMsg("─".repeat(26));
  lookAround(); // 开场即查看出生房间
  refreshButtons(); // 生成初始按钮
}

/* 页面加载完成后启动游戏 */
window.addEventListener("load", initGame);
