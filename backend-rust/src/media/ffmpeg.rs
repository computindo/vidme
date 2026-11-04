use std::path::Path;
use tokio::process::Command;

const PORTRAIT_VF: &str = "scale=270:480:force_original_aspect_ratio=increase,crop=270:480";
const LANDSCAPE_VF: &str = "scale=320:180:force_original_aspect_ratio=increase,crop=320:180";

fn vf_for(is_portrait: bool) -> &'static str {
    if is_portrait {
        PORTRAIT_VF
    } else {
        LANDSCAPE_VF
    }
}

pub async fn transcode_remux(input: &str, output: &str) -> Result<(), String> {
    let output_res = Command::new("ffmpeg")
        .args([
            "-y",
            "-i",
            input,
            "-c",
            "copy",
            "-movflags",
            "+faststart",
            output,
        ])
        .output()
        .await
        .map_err(|e| format!("Failed to spawn ffmpeg: {}", e))?;

    if !output_res.status.success() {
        let err = String::from_utf8_lossy(&output_res.stderr);
        return Err(format!("ffmpeg remux failed: {}", err));
    }

    Ok(())
}

pub async fn extract_thumbnail(input: &str, output: &str, is_portrait: bool) -> Result<(), String> {
    let vf = vf_for(is_portrait);
    let output_res = Command::new("ffmpeg")
        .args([
            "-y",
            "-ss",
            "5",
            "-i",
            input,
            "-vframes",
            "1",
            "-vf",
            vf,
            output,
        ])
        .output()
        .await
        .map_err(|e| format!("Failed to spawn ffmpeg thumb: {}", e))?;

    if !output_res.status.success() {
        let err = String::from_utf8_lossy(&output_res.stderr);
        return Err(format!("ffmpeg thumbnail failed: {}", err));
    }

    Ok(())
}

pub async fn generate_storyboard(
    src: &str,
    out: &str,
    dur: i64,
    is_portrait: bool,
) -> Result<bool, String> {
    if dur <= 0 {
        return Ok(false);
    }

    let vf = vf_for(is_portrait);
    let ratios = [0.0f64, 0.25f64, 0.50f64, 0.75f64];

    let mut sel_parts = Vec::new();
    for (i, r) in ratios.iter().enumerate() {
        let t = (dur as f64) * r;
        let t0 = (t - 0.25).max(0.0);
        let t1 = t + 0.25;
        sel_parts.push(format!(
            "[s{i}]select='gte(t\\,{t0:.2})*lt(t\\,{t1:.2})',{vf},format=yuvj420p[f{i}]"
        ));
    }

    let fc = format!(
        "[0:v]split=4[s0][s1][s2][s3];{};[f0][f1][f2][f3]xstack=inputs=4:layout=0_0|w0_0|0_h0|w0_h0[xs];[xs]format=yuvj420p[v]",
        sel_parts.join(";")
    );

    let output_res = Command::new("ffmpeg")
        .args([
            "-y",
            "-err_detect",
            "ignore_err",
            "-fflags",
            "+discardcorrupt",
            "-i",
            src,
            "-filter_complex",
            &fc,
            "-map",
            "[v]",
            "-frames:v",
            "1",
            "-update",
            "1",
            "-q:v",
            "5",
            out,
        ])
        .output()
        .await
        .map_err(|e| format!("Failed to spawn ffmpeg storyboard: {}", e))?;

    if !output_res.status.success() {
        let err = String::from_utf8_lossy(&output_res.stderr);
        return Err(format!("ffmpeg storyboard failed: {}", err));
    }

    let exists = Path::new(out).exists();
    Ok(exists)
}

struct ClipPlan {
    pct: Vec<f64>,
    seg: f64,
}

fn clip_plan(dur: i64) -> ClipPlan {
    if dur >= 1800 {
        ClipPlan {
            pct: vec![0.15, 0.30, 0.45, 0.60, 0.75, 0.90],
            seg: 1.7,
        }
    } else {
        ClipPlan {
            pct: vec![0.25, 0.50, 0.75, 0.95],
            seg: 1.5,
        }
    }
}

pub async fn generate_microclip(
    src: &str,
    out: &str,
    dur: i64,
    is_portrait: bool,
) -> Result<bool, String> {
    if dur < 5 {
        return Ok(false);
    }

    let plan = clip_plan(dur);
    let tmp = format!("{}.tmp.webm", out);
    let vf = vf_for(is_portrait);

    let positions: Vec<f64> = plan
        .pct
        .iter()
        .map(|&p| {
            let val = (dur as f64) * p;
            let max_val = (dur as f64) - plan.seg - 0.5;
            (val.min(max_val).max(0.0) * 100.0).round() / 100.0
        })
        .collect();

    let mut args: Vec<String> = vec![
        "-y".into(),
        "-err_detect".into(),
        "ignore_err".into(),
        "-fflags".into(),
        "+discardcorrupt".into(),
    ];

    for p in &positions {
        args.push("-ss".into());
        args.push(format!("{:.2}", p));
        args.push("-t".into());
        args.push(format!("{:.2}", plan.seg));
        args.push("-i".into());
        args.push(src.into());
    }

    let mut filter_segments = Vec::new();
    let mut concat_inputs = Vec::new();
    for i in 0..positions.len() {
        filter_segments.push(format!(
            "[{i}:v]{vf},fps=20,format=yuv420p,setsar=1,setpts=PTS-STARTPTS[s{i}]"
        ));
        concat_inputs.push(format!("[s{i}]"));
    }

    let fc = format!(
        "{};{}concat=n={}:v=1:a=0[v]",
        filter_segments.join(";"),
        concat_inputs.join(""),
        positions.len()
    );

    args.push("-filter_complex".into());
    args.push(fc);
    args.push("-map".into());
    args.push("[v]".into());
    args.push("-an".into());
    args.push("-c:v".into());
    args.push("libsvtav1".into());
    args.push("-preset".into());
    args.push("8".into());
    args.push("-crf".into());
    args.push("32".into());
    args.push("-r".into());
    args.push("20".into());
    args.push("-colorspace".into());
    args.push("bt709".into());
    args.push("-color_primaries".into());
    args.push("bt709".into());
    args.push("-color_trc".into());
    args.push("bt709".into());
    args.push("-color_range".into());
    args.push("tv".into());
    args.push(tmp.clone());

    let output_res = Command::new("ffmpeg")
        .args(&args)
        .output()
        .await
        .map_err(|e| format!("Failed to spawn ffmpeg microclip: {}", e))?;

    if !output_res.status.success() {
        let _ = tokio::fs::remove_file(&tmp).await;
        let err = String::from_utf8_lossy(&output_res.stderr);
        return Err(format!("ffmpeg microclip failed: {}", err));
    }

    if let Ok(meta) = tokio::fs::metadata(&tmp).await {
        if meta.len() > 0 {
            let _ = tokio::fs::rename(&tmp, out).await;
            return Ok(true);
        }
    }

    let _ = tokio::fs::remove_file(&tmp).await;
    Ok(false)
}
