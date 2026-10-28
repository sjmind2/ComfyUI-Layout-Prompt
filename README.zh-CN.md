# ComfyUI Layout Prompt Builder（布局提示词构建器）

[English](README.md) | **简体中文**

![Layout Prompt Builder 在 MOSS-Image 工作流中编辑五个边界框](examples/showcase.png)

一个用于交互式构建 **MOSS-Image 布局提示词（layout prompt）** 的 ComfyUI 自定义节点。它把输出尺寸选择器、边界框编辑器和布局提示词序列化器合并到了一个节点中：设置全局场景提示词（`summary`）和输出形状，在白底画布或参考图上绘制边界框，为每个框设置标签和描述，然后输出 `width`、`height` 和布局提示词字符串。

它可以替代 MOSS 工作流中的 `ResolutionSelector`、`CreateBoundingBoxes` 和 `MOSSImageLayoutPrompt`。

## 功能

- 通过宽高比和百万像素数（megapixels）确定输出尺寸，宽高都会取整为 16 的倍数。
- 在始终代表精确输出矩形的画布上绘制、移动、缩放、复制、排序和删除边界框。
- 每个框支持 `label`（`character`、`object`、`text`）、`caption`，以及 `text` 类型专用的 `text` 字段。
- 背景可以是白底、上传的参考图，或最近一次生成的图片。
- 参考图支持 `Fill`/`Fit`、以指针为锚点的 50%–800% 缩放，以及带边界限制的平移。
- 布局和参考图的修改都支持撤销/重做；画布与列表共享选择状态。
- 所有内容随工作流保存；只保存参考图描述符，不写入图片字节。

## 安装

1. 把本仓库克隆到 ComfyUI 的 `custom_nodes` 目录：

   ```bash
   cd ComfyUI/custom_nodes
   git clone https://github.com/sjmind2/ComfyUI-Layout-Prompt.git
   ```

2. 重启 ComfyUI 服务器，并在浏览器中强制刷新（`Ctrl+F5` 或 `Shift`+刷新）。
3. 在 **model/conditioning/moss_image** 分类下添加 **Layout Prompt Builder** 节点。

没有额外的 Python 依赖，也不需要构建：`layout_core.py` 只使用标准库，`nodes.py` 使用 ComfyUI 的 V3 `comfy_api.latest` API，编辑器是原生 ES 模块。需要较新的 ComfyUI（V3 节点 API，以及示例工作流使用的较新核心节点）。

## 示例工作流

[下载示例工作流](examples/layout-prompt-moss-image.json)。上方截图展示了它编辑钢琴场景的五个边界框，右侧是生成结果。

该工作流使用了：

- **本节点**：提供布局提示词和输出尺寸。
- 内嵌的 **Text to Image (MOSS-Image)** 子图，由核心节点组成（需要较新的 ComfyUI）。
- [rgthree-comfy](https://github.com/rgthree/rgthree-comfy) 提供的 `Seed (rgthree)` 节点。
- 子图中选择的模型：`moss_image_sft_int8_convrot.safetensors`、`qwen3.5_9b_w4a8_gptq.safetensors` 和 `flux2-vae_small.safetensors`。

截图使用的参考图是私有图片，**没有随仓库提供**：工作流加载后是**白底画布**，五个边界框都会保留。可以点击 `Pick file` 加载你自己的参考图，或继续使用白底。示例为 1:1、1.0 MP，包含一个 `text` 框、一个 `character` 框和三个 `object` 框。

## 使用节点

1. 设置 `summary`（全局场景/风格提示词）、`aspect_ratio` 和 `megapixels`。
   - 宽高比：`1:1 (Square)`、`2:3 (Portrait Photo)`、`3:2 (Photo)`、`3:4 (Portrait Standard)`、`4:3 (Standard)`、`9:16 (Portrait Widescreen)`、`16:9 (Widescreen)`、`21:9 (Ultrawide)`。
   - `megapixels` 支持 0.1–16.0，步长 0.1（默认 1.0；MOSS 通常使用 1–2 MP）。
   - 宽高都会取整为 16 的倍数。例如 1:1、1.0 MP 为 1024×1024；16:9、1.0 MP 为 1360×768。
2. 在画布上绘制边界框，并在边界框列表中编辑对应的行。新框默认使用 `character` 标签和空描述。
3. 把 `width`、`height` 和 `prompt` 连接到 MOSS 工作流需要输出尺寸和布局字符串的位置。

画布始终代表精确的输出矩形，并按节点大小缩放显示。工具栏下方的提示行会显示当前输出尺寸和变换快捷键。

### 迭代布局

这个节点是为快速多轮调整而设计的：

- **人物身体被拉伸** → 调整身体各部位的边界框位置。
- **部位错误、合并或缺失** → 调整框的描述和大小。
- **主体数量或特征错误** → 调整 `summary`，并增加或删除边界框。
- 在白底、参考图和最近生成的图片之间切换背景，无需重建工作流即可持续迭代。

### 键盘焦点

当键盘焦点位于面板内任意非编辑区域时，编辑快捷键（微调、删除、复制、撤销/重做、`Esc`）都会生效：包括画布、边界框行、工具栏按钮或面板空白处。点击画布或面板空白处会把焦点放到画布；点击行主体会把焦点放到该行。在描述/`text` 输入框内，按键保持正常的文本编辑行为（包括浏览器的原生 `Ctrl+Z`），不会修改布局。编辑器会消费自己处理的按键，因此 ComfyUI 工作流不会收到这些按键。

### 边界框编辑

| 操作 | 控件 |
|---|---|
| 绘制边界框 | 在空白画布上按住左键拖动。短于 3 个显示像素的拖动视为点击（取消选择）。边界框会被限制在画布内，追加到列表并选中。 |
| 移动边界框 | 在框内按住左键拖动。 |
| 调整边界框大小 | 拖动选中框的 8 个手柄（四角和四条边的中点）。最小尺寸为 3 个显示像素。 |
| 选择 | 点击画布上的框，或点击列表行。画布和列表共享选择；在画布上选择会把对应行滚动到可见区域。 |
| 取消选择 | `Esc`（面板获得焦点时），或点击空白画布。 |
| 添加边界框 | 列表标题栏的 `+ add`。添加一个居中的 20% 框（0–1000 坐标 `[400,400,600,600]`），标签为 `character`，并聚焦其描述输入框。 |
| 编辑边界框 | 在对应行中：标签下拉框（`character`、`object`、`text`）、描述输入框，以及仅对 `text` 标签显示的 `text` 输入框。编辑在失焦或短暂停止输入后提交。 |
| 复制 | `Ctrl+D`（面板获得焦点时），或行内的复制按钮。副本保持原尺寸，在能放下时偏移 30 个单位；靠近右/下边缘时反向偏移 30 个单位；占满整帧的框保持不动。副本会被选中。 |
| 排序 | 行内的上/下按钮。列表顺序就是 JSON 中 `items` 的顺序，也是画布的绘制顺序：后面的项绘制在前面，但选中的框始终最后绘制。 |
| 删除 | `Delete` 或 `Backspace`（面板获得焦点时），或行内的删除按钮。 |
| 微调 | 方向键移动选中的框 1 个单位；`Shift`+方向键移动 10 个单位（编辑器使用 0–1000 坐标）。 |
| 撤销 / 重做 | `Ctrl+Z` / `Ctrl+Shift+Z`（macOS 上也可使用 `Cmd`）。 |

### 参考图视图

| 操作 | 控件 |
|---|---|
| 白底 / 参考图（White / Reference） | 工具栏切换。仅影响显示：保留已加载的参考图，本身不是撤销步骤。 |
| 选择文件（Pick file） | 工具栏按钮。上传本地图片并作为参考图。 |
| 使用上次生成（Use last） | 工具栏按钮。使用最近一次生成的图片作为参考图；在知道可用图片前处于禁用状态。加载时会从 ComfyUI 历史记录中恢复最新图片，因此刷新页面后、或图片在节点创建之前生成时也可使用。启用时标题为 "Use the last generated image as the reference"；禁用时标题为 "No generated image available yet — run the workflow"。 |
| 填充 / 适应（Fill / Fit） | 工具栏切换。`Fill` 覆盖画布并裁剪溢出部分；`Fit` 完整显示图片并在两侧留边。两者都会把缩放重置为 100% 并重新居中。 |
| 缩放参考图 | 在画布上滚动鼠标滚轮，以指针位置为锚点；`−`/`+` 按钮每次调整 10 个百分点。`zoom %` 标签显示当前值。滚轮事件始终被编辑器消费，ComfyUI 画布不会缩放。 |
| 平移参考图 | 开启 `Move bg` 后拖动，按住 `Space` 左键拖动，或中键拖动。 |
| 移动参考图（Move bg） | 工具栏切换。激活时，左键拖动会平移参考图而不是编辑边界框。 |

## 参考图

参考图位于边界框下方，亮度降低到约 55%，以便看清布局。它仅作为参考：不会进入提示词、节点输出或工作流。

### 来源

- **选择文件（Pick file）** 会把图片上传到 ComfyUI 的 `input` 目录，文件名唯一，格式为 `layout_ref_<node>_<timestamp>_<random>.<ext>`（`type=input`、`overwrite=true`）。只保存描述符 `{filename, type, subfolder}`，因此只要文件仍在，参考图就能在工作流保存和 ComfyUI 重启后继续使用。把工作流移到另一台机器时可能找不到该文件。
- **使用上次生成（Use last）** 使用编辑器已知的最新图片：初始为 ComfyUI 历史记录中的最新生成图片（`/history?max_items=20`，每次页面加载请求一次），之后由每个新的 `executed` 事件更新（一次事件报告多张时取最后一张）。历史记录是 ComfyUI 实例全局的。新的执行只会更新按钮，不会自动替换当前显示的参考图；点击 `Use last` 才会应用。刷新页面后，即使工作流没有保存过 last 描述符，按钮也会从历史记录重新启用。上次生成的图片通常位于 ComfyUI 的 temp 目录，之后可能被清理。
- 工具栏上的 `file` 或 `last` 小徽标表示已保存的参考图来源（选择 `White` 时仍然可见）。
- 如果上传、图片解码或 `Use last` 加载失败，会保留之前的参考图并在提示行显示错误。成功上传/加载或切换白底/参考图会清除该消息；该消息会跨内部参考图重载和画布重排保留。

### 变换

- `Fill`（默认）缩放参考图以覆盖画布并裁剪溢出部分；`Fit` 完整显示图片并在两侧留边。
- 缩放范围为当前 Fill/Fit 基础比例的 50%–800%；100% 表示预设比例。滚轮缩放以指针为锚点，`−`/`+` 每次调整 10 个百分点。
- 使用 `Move bg` + 拖动、`Space` + 左键拖动或中键拖动来平移。平移会被限制：比画布大的参考图始终覆盖画布，比画布小的参考图始终完整位于画布内。
- 修改 `aspect_ratio` 或 `megapixels` 会重新适配画布。边界框保持归一化坐标不变，参考图保持缩放和原本位于画布中心的图像点。
- 参考图的 Fit/Fill/缩放/平移和来源切换与边界框编辑共用同一撤销历史。撤销或重做平移/缩放会从服务器重新加载参考图，因此可能短暂显示加载状态。

## 持久化

- 边界框数据（id、label、caption、text、bbox）和列表顺序保存在隐藏的 `boxes_json` 控件中，并随工作流保存。选择状态不保存。

```json
{
  "version": 1,
  "boxes": [
    {
      "id": "box_example",
      "label": "character",
      "caption": "hatsune miku",
      "text": "",
      "bbox": [100, 200, 400, 600]
    }
  ]
}
```

- 背景状态保存在 `node.properties.layoutPromptBg`，格式为 `{mode, source, file, last, fit, zoom, panX, panY}`，并随工作流保存。只保存参考图描述符，不会把图片字节或 base64 数据写入工作流。
- 重新加载时，编辑器恢复边界框和参考图变换。如果保存的参考图文件缺失，画布回退为白底并显示 "reference unavailable" 提示（仅在参考图模式下显示），同时保留描述符和平移值，以便之后恢复文件。
- `White`/`Reference` 仅影响显示。选择文件或使用 `Use last` 是可撤销的来源编辑。

## 输出

| 输出 | 类型 | 含义 |
|---|---|---|
| `width` | INT | 输出宽度（像素）。 |
| `height` | INT | 输出高度（像素）。 |
| `prompt` | STRING | MOSS-Image 布局提示词。 |

`width` 和 `height` 由宽高比和百万像素数计算：

```
scale = sqrt(megapixels * 1024 * 1024 / (w_ratio * h_ratio))
width  = round(w_ratio * scale / 16) * 16
height = round(h_ratio * scale / 16) * 16
```

宽高始终是 16 的倍数。

### 提示词 JSON

至少有一个边界框时，`prompt` 是紧凑的 UTF-8 JSON，结构如下（`summary` 会被去除首尾空白）：

```json
{"summary":{"caption":"1girl, long hair"},"items":[{"label":"character","caption":"hatsune miku","bbox":[-410,-308,-102,103]},{"label":"text","caption":"shop sign","text":"こんにちは","bbox":[0,-410,410,308]}],"bbox_coord_space":"abs_centralized","bbox_format":"yxyx"}
```

- `items` 按列表顺序排列。每一项包含 `label` 和 `caption`；只有 `text` 项还包含 `text`（要渲染的字面文字）。
- 编辑器中的每个 bbox 都是 0–1000 的整数 `[y0, x0, y1, x1]`（y 在前；y 对应输出高度，x 对应输出宽度）。输出中的 `bbox` 是以画布中心为原点的绝对像素 `[y0, x0, y1, x1]`：低边使用 `floor(round(value * dimension / 1000, 9)) - dimension // 2`，高边使用 `ceil(...) - dimension // 2`。例如 `[100,200,400,600]` 在 1024×1024 下变为 `[-410,-308,-102,103]`。
- 标签只能是 `character`、`object` 和 `text`。未知标签按 `object` 处理。
- `bbox_coord_space` 为 `"abs_centralized"`，`bbox_format` 为 `"yxyx"`。不包含 `palette`、`meta`、`canvas` 或 `tags` 字段。

没有边界框时，`prompt` 就是原样输入的 `summary`（不会去除首尾空白）；空的 `summary` 加空框会得到空字符串。如果保存的框数据非空但无法使用，节点会记录一条警告并输出原样的 `summary`。

### 布局 JSON 兼容性

对于相同的边界框和输出尺寸，提示词与 `MOSSImageLayoutPrompt` 逐字节一致。`CreateBoundingBoxes` 会先通过它的像素画布重新量化边界框（并可能添加 palette 数据），因此要与完整链完全一致，框需要能通过那次往返量化。本节点可以在 MOSS 工作流中替代该链（以及 `ResolutionSelector`）。

## 限制（v1）

- 没有工作流的 `IMAGE` 输入。参考图来源是上传的文件和最近一次生成的输出（实时执行或 ComfyUI 历史记录）。
- 不包含 `palette`、`meta`、`canvas`（多面板）或 `tags` 字段；布局为单面板。
- MOSS-Image 的布局提示词上游仍处于实验阶段。对于相同的输入框，JSON 与已安装的 `MOSSImageLayoutPrompt` 逐字节兼容；兼容性直接针对该节点检查，完整 `CreateBoundingBoxes` 链只针对能通过其重新量化的固定样例检查。上游格式可能变化。
- 参考图仅用于辅助构图；它本身不会影响布局 JSON 或生成图片。
- 撤销/重做平移或缩放时，会通过重新加载参考图来恢复变换，因此可能短暂出现加载状态或白画布。
- 历史记录查询是 ComfyUI 实例全局的，且只查最新的 20 条。如果 ComfyUI 历史记录为空或被清除，`Use last` 会回退到工作流中保存的 last 描述符（如果有）。
- 没有自动描述或边界框检测，也不支持触摸/移动端。

## 开发

```bash
# Python 核心（pytest）：19 个测试
python -m pytest tests/ -v

# 纯前端模块（Node 22 node:test）：47 个测试
npm test

# 节点 schema（4 个测试）和 MOSS 兼容性（5 个测试），使用 ComfyUI 的 Python，
# 并把 ComfyUI 代码目录加入 PYTHONPATH：
PYTHONPATH=/path/to/ComfyUI python -m unittest tests.node_schema_check tests.parity_moss_check -v
```

架构、约束、测试布局和实现注意事项见 [`CLAUDE.md`](CLAUDE.md)。
