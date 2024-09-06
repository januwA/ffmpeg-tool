const { ipcRenderer } = require('electron')
const child_process = require('node:child_process')
const path = require('node:path')
const fs = require('node:fs')
const vm = require('node:vm')
const { promisify } = require('node:util')


/**
 * 
 * from到to过去了多少秒
 * 
 * @param {string} from '00:00:00'
 * @param {string} to '00:00:10'
 * @returns {number} 10
 */
function getSecond(from, to) {
  return (Date.parse(`2000/1/1 ${to}`) - Date.parse(`2000/1/1 ${from}`)) / 1000;
}

const filter_complex_command_text_example = `
ffmpeg

-i "a.mp4" 
-i "b.mp4"
-i "c.mp4"

/* 过滤器链：由一系列以","逗号分隔的过滤器描述列表表示 */
/* 过滤器图：由一系列过滤器链组成。过滤器图列由一系列以";"分号分割 */
/* 过滤器参数以":"冒号分割，键=值对列表、值列表  */

-filter_complex "

// trim 切片输入的视频, setpts 更改输入帧的 PTS, scale 统一分辨率
[0:v]trim=0:10,  setpts=PTS-STARTPTS, setpts=0.5*PTS,  scale=1280:720 [v0]; 
[1:v]trim=10:20, setpts=PTS-STARTPTS, setpts=0.5*PTS, scale=1280:720 [v1]; 
[0:v]trim=15:30, setpts=PTS-STARTPTS, setpts=1/1.2*PTS, scale=1280:720 [v2]; 

// concat 合并输出
[v0][v1][v2] concat=n=3:v=1:a=0 [ov];
"

// 输出的视频
-map "[ov]" 

// 输出的音频
-map 2:a:0 -shortest 

// 输出帧速率
-r 60 

// 视频比特率
-b:v 800k

// 选择视频流的编码器/解码器
-c:v mpeg4 

// 使用ffplay预览
-f mpegts - | ffplay -`.trimStart();

let vvm = new Vue({
  el: '#app',
  data() {
    let filter_complex_command_text = localStorage.getItem('filter_complex_command_text');
    let input = localStorage.getItem('input');

    return {
      filter_complex_command_text: filter_complex_command_text || filter_complex_command_text_example,
      displayCommand: true,
      notExec: false,
      output_ffplay: false,
      commandText: '',
      input: input || '',
      Set_Video_Volume_value: '1.0',
      playOpt: {
        isLoopPlay: false,
        t_noborder: false,
        t_vn: false,
        t_an: false,
        t_subtitles: false,
        t_subtitles_si: 0,
        t_setpts: 1,
        t_size: '1280x720',
      },
      mergeAudioVideo: {
        input: '',
        isAmix: false,
      },
      getVideoCut: {
        begin1: '00:00:00',
        end1: '00:00:10',

        begin2: '00:00:00',
        end2: '00:00:10',

        begin3: '00:00:00',
      },
      cropVideo: {
        w: '600',
        h: '600',
        x: '(iw-600) / 2',
        y: '(ih-600) / 2',
      }
    }
  },
  watch: {
    filter_complex_command_text(nv) {
      localStorage.setItem('filter_complex_command_text', nv);
    },
    async input(nv) {
      localStorage.setItem('input', nv);

      if (nv && fs.existsSync(nv)) {
        let dir = path.dirname(nv);
        let files = await promisify(fs.readdir)(dir);
        let input_dir_files = [];
        for (const name of files) {
          let full_path = path.join(dir, name);
          let s = await promisify(fs.stat)(full_path);
          if (s.isFile()) {
            input_dir_files.push(full_path);
          }
        }
        this.input_dir_index = input_dir_files.indexOf(nv);
        this.input_dir_files = input_dir_files;
      }
    },
    displayCommand(nv) {
      if (nv) {
        this.output_ffplay = false;
      }
    },
    output_ffplay(nv) {
      if (nv) {
        this.displayCommand = false;
      }
    }
  },
  methods: {
    changeInput(n) {
      if (Array.isArray(this.input_dir_files)) {
        this.input_dir_index += n;
        if (this.input_dir_index >= this.input_dir_files.length) {
          this.input_dir_index = 0;
        } else if (this.input_dir_index < 0) {
          this.input_dir_index = this.input_dir_files.length - 1;
        }
        this.input = this.input_dir_files[this.input_dir_index];
      }
    },
    /**
     * 将处理后的资源，写入相同目录下
     * 
     * @param {string} extension 
     * @returns 
     */
    GetOutput(extension = "") {
      if (!this.input) return null;

      // 将ffmpeg的输出转换为MPEG-TS 等流媒体格式，发送给ffplay播放
      if (this.output_ffplay) {
        // matroska or mpegts or avi
        return ` -f mpegts - | ${this.ffplay(true)}`
      }

      extension = extension.length != 0 ? extension : path.extname(this.input);

      // xxx/xxx/[time]oldname.extension
      return '"' + path.join(
        path.dirname(this.input),
        `[${Date.now()}]-${path.basename(this.input, path.extname(this.input))}${extension}`
      ) + '"';
    },
    /**
     * 
     * @param {string} command 
     */
    exec(command) {
      this.commandText = command;

      // start 可以显示控制台，展示更多信息
      if (this.displayCommand && !command.includes(' ffplay ')) {
        command = 'start ' + command;
      }

      if (!this.notExec) {
        child_process.exec(command, (err, stdout, stderr) => {
          if (err) {
            console.error(err);
            return;
          }
          console.log(stdout, stderr);
        });
      }
    },

    /**
     * 选择输入文件
     */
    async getinput() {
      ipcRenderer.invoke('open-file-dialog').then(res => {
        if (res) {
          this.input = res;
        }
      });
    },

    /**
     * 去掉视频音轨
     */
    Remove_Video_Audio() {
      // ffmpeg -i "demo.mp4" -vcodec copy -an "out.mp4"
      let command = `ffmpeg -i "${this.input}" -vcodec copy -an ${this.GetOutput()}`;
      this.exec(command);
    },

    /**
     * 提取视频音轨
     */
    Get_Video_Audio() {
      // ffmpeg -i demo.mp4  out.mp3
      let command = `ffmpeg -i "${this.input}" ${this.GetOutput('.mp3')}`;
      this.exec(command);
    },

    /**
     * 调整音量
     */
    Set_Video_Volume() {
      // 视频不变，减少音量
      // ffmpeg -i input.mp4 -vcodec copy -af "volume=-10dB"  out.mp4
      let command = `ffmpeg -i "${this.input}" -vcodec copy -af "volume=${this.Set_Video_Volume_value}" ${this.GetOutput()}`
      this.exec(command);
    },

    /**
     * 下载m3u8到mp4
     */
    Download_M3U8_To_Mp4() {
      // ffmpeg -i http://xxx/index.m3u8 -bsf:a aac_adtstoasc -c copy out.mp4

      ipcRenderer.invoke('open-dir-dialog').then(res => {
        if (res) {
          let command = `ffmpeg -i "${this.input}" -bsf:a aac_adtstoasc -c copy "${path.join(res, `${Date.now()}.mp4`)}"`
          this.exec(command);
        }
      });
    },

    /**
     * 将输入文件转为MP4格式的视频文件
     */
    Convert_Video_Format_To_Mp4() {
      // ffmpeg -i output.flv -vcodec libx264 -pix_fmt yuv420p -c:a copy o5.mp4
      let command = `ffmpeg -i "${this.input}" -vcodec libx264 -pix_fmt yuv420p -c:a copy ${this.GetOutput(".mp4")}`;
      this.exec(command);
    },

    /**
     * 使用ffplay播放输入资源，视频，音频，图片，直播流...
     */
    ffplay(isPipe = false) {
      // ffmpeg - i "C:\Users\16418\Desktop\[Sakurato] Ookami to Koushinryou：Merchant Meets the Wise Wolf [20][HEVC-10bit 1080p AAC][CHS&CHT].mkv" - filter_complex "[0:v] setpts=PTS-STARTPTS,subtitles='C\:\\\Users\\\16418\\\Desktop\\\[Sakurato] Ookami to Koushinryou：Merchant Meets the Wise Wolf [20][HEVC-10bit 1080p AAC][CHS&CHT].mkv':si=0, setpts=1/2*PTS [v0]; [0:a] asetpts=PTS-STARTPTS, asetpts=1/2*PTS, atempo=2 [a0]; [v0][a0] concat=n=1:v=1:a=1 [ov] [oa]" - map "[ov]" - map "[oa]" - r 60 - b:v 800k - f mpegts - | ffplay -x 1280 -y 720 -

      // ffplay - x 1280 - y 720 - vf "setpts=PTS-STARTPTS, subtitles='C\:\\\Users\\\16418\\\Desktop\\\[Sakurato] Ookami to Koushinryou：Merchant Meets the Wise Wolf [20][HEVC-10bit 1080p AAC][CHS&CHT].mkv':si=0, setpts=1/2*PTS" - af "asetpts=PTS-STARTPTS, asetpts=1/2*PTS, atempo=2"  "C:\Users\16418\Desktop\[Sakurato] Ookami to Koushinryou：Merchant Meets the Wise Wolf [20][HEVC-10bit 1080p AAC][CHS&CHT].mkv"

      let options = [];
      if (this.playOpt.t_size) {
        let [w, h] = this.playOpt.t_size.split('x');
        if (w) options.push(`-x ${w}`);
        if (h) options.push(`-y ${h}`);
      }

      if (this.playOpt.isLoopPlay) {
        options.push('-loop 0');
      }
      if (this.playOpt.t_noborder) {
        options.push('-noborder');
      }
      if (this.playOpt.t_vn) {
        options.push('-vn');
      }
      if (this.playOpt.t_an) {
        options.push('-an');
      }

      let vf_arr = [];
      let af_arr = [];

      if (this.playOpt.t_subtitles) {
        vf_arr.push(`subtitles='${this.input
          .replace(/\\/g, '\\\\\\') // 替换路径分隔符
          .replace(/:/g, '\\\:') // 替换 : 符号
          }':si=${this.playOpt.t_subtitles_si || 0}`);
      }

      if (this.playOpt.t_setpts && this.playOpt.t_setpts != 1) {
        vf_arr.push(`setpts=PTS-STARTPTS`, `setpts=1/${this.playOpt.t_setpts}*PTS`);
        af_arr.push(`asetpts=PTS-STARTPTS`, `asetpts=1/${this.playOpt.t_setpts}*PTS`, `atempo=${this.playOpt.t_setpts}`);
      }
      if (vf_arr.length) {
        options.push(`-vf "${vf_arr.join(', ')}"`);
      }
      if (af_arr.length) {
        options.push(`-af "${af_arr.join(', ')}"`);
      }

      let command = `ffplay ${options.join(' ')} `;

      if (isPipe) {
        command += ' -'
        return command;
      }
      else {
        command += ` "${this.input}"`;
        this.exec(command);
      }
    },

    ffplayMessage() {
      ipcRenderer.invoke('showMessageBox', {
        title: '播放控制',
        detail: `q, ESC
退出。

f
切换全屏

p, SPACE
暂停。

m
切换静音。

9, 0
分别减少和增加音量。

/, *
分别减少和增加音量。

a
在当前程序中循环播放音频通道。

v
循环播放视频频道。

t
在当前节目中循环字幕频道。

c
循环程序。

w
循环播放视频滤镜或显示模式。

s
跳到下一帧(提前暂停)。

left/right
向后/向前搜索10秒。

down/up
向后/向前搜索1分钟。

page down/page up
寻求上一章/下一章。或如果没有章节(op/ed)，则向后/向前搜索10分钟。
`,
        type: 'info',
        buttons: ['确定']
      }).then(res => {
        console.log(res);

      });
    },

    /**
     * 选择混音的音频文件
     */
    Open_Audio_Dialog() {
      ipcRenderer.invoke('open-file-dialog').then(res => {
        if (res) this.mergeAudioVideo.input = res;
      });
    },

    /**
     * 音频填充视频
     */
    Audio_full_video() {
      // 将10s视频和5s音频合并，输出视频有10s,音频将一直循环
      // ffmpeg -i input.mp4 -stream_loop -1 -i input.mp3 -c copy -map 0:v:0 -map 1:a:0 -shortest out.mp4
      let command = `ffmpeg -i "${this.input}"  -stream_loop -1 -i "${this.mergeAudioVideo.input}"  -c copy -map 0:v:0 -map 1:a:0 -shortest ${this.GetOutput()}`;

      // https://ffmpeg.org/ffmpeg-filters.html#toc-amix
      if (this.mergeAudioVideo.isAmix) {
        // ffmpeg -i 4.mp4 -i a1.mp3 -c:v copy -filter_complex amix -map 0:v -map 0:a -map 1:a -shortest o.mp4
        command = `ffmpeg -i "${this.input}"  -stream_loop -1 -i "${this.mergeAudioVideo.input}" -c:v copy -filter_complex amix -map 0:v:0 -map 1:a:0 -shortest ${this.GetOutput()}`;
      }
      this.exec(command);
    },

    /**
     * 视频填充音频，无法混音
     */
    Video_full_audio() {
      // 将5s视频和10s音频合并，输出视频有10s,视频将一直循环
      // ffmpeg -stream_loop -1 -i input.mp4 -i input.mp3 -c copy -map 0:v:0 -map 1:a:0 -shortest out.mp4
      let command = `ffmpeg -stream_loop -1 -i "${this.input}" -i "${this.mergeAudioVideo.input}" -c copy -map 0:v:0 -map 1:a:0 -shortest ${this.GetOutput()}`;

      this.exec(command);
    },

    /**
     * 合并两个音频
     */
    merge_audio() {
      // ffmpeg.exe -i a1.mp3 -i a2.mp3 -filter_complex amerge -c:a libmp3lame -q:a 4 out.mp3
      let command = `ffmpeg.exe -i "${this.input}" -i "${this.mergeAudioVideo.input}" -filter_complex amerge -c:a libmp3lame -q:a 4 ${this.GetOutput('.mp3')}`;
      this.exec(command);
    },

    ffprobe() {
      // cmd.exe /K ffprobe "C:\Users\16418\Downloads\[Sakurato] Ookami to Koushinryou：Merchant Meets the Wise Wolf [20][HEVC-10bit 1080p AAC][CHS&CHT].mkv"
      this.exec(`cmd.exe /K ffprobe "${this.input}"`);
    },

    /**
     * 从开始处裁剪指定时间
     */
    cut_video_time() {
      // ffmpeg -i input.mp4 -ss 00:00:00 -t 10 -c copy 1.mp4
      let command = `ffmpeg -i "${this.input}" -ss ${this.getVideoCut.begin1} -t ${this.getVideoCut.end1} -c copy ${this.GetOutput()}`;
      this.exec(command);
    },

    /**
     * 时间段裁剪
     */
    cut_video_to() {
      // 获取秒数差
      let t = getSecond(this.getVideoCut.begin2, this.getVideoCut.end2);

      if (t < 0) return;

      // ffmpeg -i input.mp4 -ss 00:00:00 -t 10 -c copy 1.mp4
      let command = `ffmpeg -i "${this.input}" -ss ${this.getVideoCut.begin2} -t ${t} -c copy ${this.GetOutput()}`;
      this.exec(command);
    },

    /**
     * 从指定时间道结束
     */
    cut_video_to_end() {
      // 从1小时到结尾
      // ffmpeg -ss 01:00:00 -i m.mp4 -c copy out.mp4
      let command = `ffmpeg -ss ${this.getVideoCut.begin3} -i "${this.input}" -c copy ${this.GetOutput()}`;
      this.exec(command);
    },

    /**
     * 裁剪视频
     * 
     * https://ffmpeg.org/ffmpeg-filters.html#toc-crop
     */
    crop_video() {
      // ffmpeg -i input.mp4 -filter:v "crop=w:h:x:y" -c:a copy output.mp4
      let command = `ffmpeg -i "${this.input}" -filter:v "crop=${this.cropVideo.w}:${this.cropVideo.h}:${this.cropVideo.x}:${this.cropVideo.y}" -c:a copy ${this.GetOutput()}`;
      this.exec(command);
    },

    /**
     * 将视频分为多个片
     */
    async split_video() {
      let outDir = path.join(
        path.dirname(this.input),
        `[${Date.now()}]-${path.basename(this.input, path.extname(this.input))}`
      );

      await promisify(fs.mkdir)(outDir);

      let out = path.join(outDir, `%0${this.$refs.split_video_num_input.value}d${this.$refs.split_video_ext_input.value}`);

      // ffmpeg -i input.mp4 -c copy -map 0 -segment_time 00:01:00 -f segment out-%03d.ts
      let command = `ffmpeg -i "${this.input}" -c copy -map 0 -segment_time ${this.$refs.split_video_time_input.value} -f segment "${out}"`;

      this.exec(command);
    },

    /**
     * 用户提供合并文件，然后合并分片
     */
    merge_split_video() {
      // ffmpeg -f concat -safe 0 -i i.txt -c copy out.mp4
      let command = `ffmpeg -f concat -safe 0 -i "${this.input}" -c copy ${this.GetOutput(".mp4")}`;
      this.exec(command);
    },
    /**
     * 生成视频合成配置文件
     */
    async create_merge_config_file() {
      let odir = path.dirname(this.input);
      let oextension = path.extname(this.input);
      let ocfgifile = path.join(odir, `merge-${Date.now()}.txt`);

      let files = await promisify(fs.readdir)(odir);

      // (for %i in (*.ts) do @echo file 'file:%cd%\%i') > mylist.txt

      let content = files
        .filter(f => f.endsWith(oextension))
        .map(f => path.join(odir, f))
        .map(p => `file 'file:${p}'`)
        .join('\r');

      promisify(fs.writeFile)(ocfgifile, content).then(() => {
        child_process.exec(`"${ocfgifile}"`);
      });
    },

    /**
     * gif to mp4
     */
    gif_to_mp4() {
      // ffmpeg -i input.gif -b:v 0 -crf 20 -vf "pad=ceil(iw/2)*2:ceil(ih/2)*2" -vcodec libx264 -pix_fmt yuv420p -f mp4 out2.mp4
      let command = `ffmpeg -i "${this.input}" -b:v 0 -crf 20 -vf "pad=ceil(iw/2)*2:ceil(ih/2)*2" -vcodec libx264 -pix_fmt yuv420p -f mp4 ${this.GetOutput('.mp4')}`;
      this.exec(command);
    },

    /**
     * gif to webm
     */
    gif_to_webm() {
      // ffmpeg -i input.gif -c vp9  -b:v 0 -crf 20 out3.webm
      let command = `ffmpeg -i "${this.input}" -c vp9  -b:v 0 -crf 20 ${this.GetOutput('.webm')}`
      this.exec(command);
    },

    /**
     * 视频转GIF
     */
    Video_To_Gif() {
      // ffmpeg -ss 30 -t 3 -i input.mp4 -vf "fps=10,scale=320:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse" -loop 0 output.gif
      let from = this.$refs.video_to_gif_from_input.value;
      let to = this.$refs.video_to_gif_to_input.value;
      let fps = this.$refs.video_to_gif_fps_input.value;
      let w = this.$refs.video_to_gif_w_input.value;
      let h = this.$refs.video_to_gif_h_input.value;

      // 获取秒数差
      let t = getSecond(from, to);

      if (t < 0) return;

      let command = `ffmpeg -ss ${from} -t ${t} -i "${this.input}" -vf "fps=${fps},scale=${w}:${h}:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse" -loop 0 ${this.GetOutput('.gif')}`;
      this.exec(command);
    },

    /**
     * 视频中提取图片
     */
    async extract_frames_from_video() {
      let from = this.$refs.input_1.value;
      let to = this.$refs.input_2.value;
      let fps_num = this.$refs.input_3.value;
      let num = this.$refs.input_4.value;

      let t = getSecond(from, to);
      if (t < 0) {
        return;
      }

      let outDir = path.join(path.dirname(this.input), `[${Date.now()}]-${path.basename(this.input, path.extname(this.input))}-images`);
      await promisify(fs.mkdir)(outDir);

      let output = path.join(outDir, `%${num}d.jpg`);

      // ffmpeg -i 2.mp4 -r 1 -ss 00:00:20 -t 1 -f image2 o-%4d.jpg
      let command = `ffmpeg -i "${this.input}" -r ${fps_num} -ss ${from} -t ${t} -f image2 "${output}"`;

      this.exec(command);
    },

    /**
     * 将帧图片合成视频
     */
    async frames_to_video() {
      let inputImage = path.join(path.dirname(this.input), `%${this.$refs.input_5.value}d.jpg`);

      let oout = path.join(path.dirname(this.input), `new-${Date.now()}.mp4`);

      // ffmpeg -i %2d.jpg new.mp4
      let command = `ffmpeg -i "${inputImage}" "${oout}"`;

      this.exec(command);
    },

    /**
     * 转换图片格式
     */
    Convert_Image_Format() {
      let oout = this.GetOutput(this.$refs.input_6.value);

      // ffmpeg -i i.jpg o.webp
      let command = `ffmpeg -i "${this.input}" "${oout}"`
      this.exec(command);
    },

    /**
     * 图片格式批量转换
     */
    async Convert_Images_Format() {
      let newExtension = this.$refs.input_6.value;

      let idir = path.dirname(this.input);
      let iextension = path.extname(this.input);
      let newinput = path.join(idir, `*${iextension}`);

      let fkey = '' + Date.now();
      let odir = path.join(idir, fkey);

      await promisify(fs.mkdir)(odir);

      // (for %i in (*.jpg) do ffmpeg -i %i %~ni.webp)
      // (for %i in (.\xx\*.jpg) do ffmpeg -i %i %~dpitime\%~ni.webp)
      let command = `cmd.exe /C "(for %i in ("${newinput}") do ffmpeg -i %i "%~dpi${fkey}\\%~ni${newExtension}")"`;

      this.displayCommand = false;
      this.exec(command);
      this.displayCommand = true;
    },
    /**
     * 转换视频帧率
     */
    Convert_video_frame_rate() {
      // ffmpeg -i 1.mp4 -vf "setpts=1.0*PTS" -c:a copy -r 30 o.mp4
      let command = `ffmpeg -i "${this.input}" -vf "setpts=1.0*PTS" -c:a copy -r ${this.$refs.input_7.value} ${this.GetOutput()}`
      this.exec(command);
    },
    /**
     * 转换视频的比特率
     */
    Convert_video_bitrate() {
      // ffmpeg -i 1.mp4 -b:v 1M -c:a copy o.mp4
      let command = `ffmpeg -i "${this.input}" -b:v ${this.$refs.input_8.value} -c:a copy ${this.GetOutput()}`
      this.exec(command);
    },
    /**
     * 转音频格式
     */
    Convert_Audio_Format() {
      // ffmpeg -i i.weba o.mp3
      let command = `ffmpeg -i "${this.input}" ${this.GetOutput(this.$refs.input_9.value)}`;
      this.exec(command);
    },
    exec_filter_complex_command() {
      let content = this.filter_complex_command_text;
      let script_content = '';
      let command_content = '';

      // 解析 [FFMPEG_COMMAND] 之上的脚本
      if (content.includes('[FFMPEG_COMMAND]')) {
        let r = content.split('[FFMPEG_COMMAND]');
        script_content = r[0];
        command_content = r[1];
      } else {
        command_content = content;
      }

      let context = {};
      let command = command_content;

      // 如果使用了脚本
      if (script_content.trim().length) {
        context = vm.runInNewContext(`let context = ${script_content}; context;`, {
          path,
          fs,
          promisify,
        });
        context = {
          path,
          fs,
          promisify,
          ...context,
        }
        vm.createContext(context);
        command = command.replace(/<js>([\s\S]*?)<\/js>/gi, (match, ...groups) => {
          return vm.runInContext(groups[0], context) || '';
        });
      }

      command = command.replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '')
        .replace(/[\r\n]/g, ' ')
        .replace(/\s+/g, ' ');

      console.log(command);
      this.commandText = command;

      child_process.exec((command.includes('ffplay ') ? '' : "start ") + command, (err, stdout, stderr) => {
        if (err) {
          return console.error(err);
        }

        if (stderr) {
          return console.error('stderr: ' + stderr);
        }

      });
    },
    reset_filter_complex_command_text() {
      this.filter_complex_command_text = filter_complex_command_text_example;
    }
  },
  mounted() {
    // 去掉红色波浪号
    document.querySelectorAll('input, textarea').forEach(e => {
      e.setAttribute('spellcheck', 'false');
    });
  }
})
