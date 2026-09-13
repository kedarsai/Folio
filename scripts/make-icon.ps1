# Draws the Dogear mascot (a page with a folded orange corner and a face)
# into assets\icon.png (256px) and assets\icon.ico. Run once; outputs are committed.
Add-Type -AssemblyName System.Drawing
$root = Split-Path -Parent $PSScriptRoot
$assets = Join-Path $root 'assets'
New-Item -ItemType Directory -Force $assets | Out-Null

function Draw-Mascot([int]$size) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'
  $g.Clear([System.Drawing.Color]::Transparent)
  $s = $size / 36.0
  $ink = [System.Drawing.ColorTranslator]::FromHtml('#3a261c')
  $paper = [System.Drawing.ColorTranslator]::FromHtml('#fffaf2')
  $orange = [System.Drawing.ColorTranslator]::FromHtml('#f48f2d')
  $blush = [System.Drawing.ColorTranslator]::FromHtml('#ffb35c')
  $pen = New-Object System.Drawing.Pen $ink, ([float](2.6 * $s))
  $pen.LineJoin = 'Round'
  $P = { param($x, $y) New-Object System.Drawing.PointF ([float]($x * $s)), ([float]($y * $s)) }

  $page = [System.Drawing.PointF[]]@((& $P 5 2), (& $P 23 2), (& $P 32 11), (& $P 32 34), (& $P 5 34))
  $g.FillPolygon((New-Object System.Drawing.SolidBrush $paper), $page)
  $g.DrawPolygon($pen, $page)
  $ear = [System.Drawing.PointF[]]@((& $P 23 2), (& $P 23 11), (& $P 32 11))
  $g.FillPolygon((New-Object System.Drawing.SolidBrush $orange), $ear)
  $g.DrawPolygon($pen, $ear)

  $inkBrush = New-Object System.Drawing.SolidBrush $ink
  $r = 2.1 * $s
  $g.FillEllipse($inkBrush, [float](13 * $s - $r), [float](18 * $s - $r), [float](2 * $r), [float](2 * $r))
  $g.FillEllipse($inkBrush, [float](24 * $s - $r), [float](18 * $s - $r), [float](2 * $r), [float](2 * $r))
  $b = 1.8 * $s
  $blushBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(180, $blush))
  $g.FillEllipse($blushBrush, [float](10 * $s - $b), [float](23 * $s - $b), [float](2 * $b), [float](2 * $b))
  $g.FillEllipse($blushBrush, [float](27 * $s - $b), [float](23 * $s - $b), [float](2 * $b), [float](2 * $b))
  $mouth = New-Object System.Drawing.Pen $ink, ([float](2.2 * $s))
  $mouth.StartCap = 'Round'; $mouth.EndCap = 'Round'
  $g.DrawArc($mouth, [float](14.5 * $s), [float](21 * $s), [float](8 * $s), [float](6 * $s), 20, 140)
  $g.Dispose()
  return $bmp
}

$big = Draw-Mascot 256
$big.Save((Join-Path $assets 'icon.png'), [System.Drawing.Imaging.ImageFormat]::Png)

# A PNG-compressed .ico with 16..256 px frames.
$sizes = 16, 24, 32, 48, 64, 128, 256
$frames = foreach ($sz in $sizes) {
  $bmp = Draw-Mascot $sz
  $ms = New-Object System.IO.MemoryStream
  $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  , $ms.ToArray()
}
$out = New-Object System.IO.MemoryStream
$w = New-Object System.IO.BinaryWriter $out
$w.Write([uint16]0); $w.Write([uint16]1); $w.Write([uint16]$sizes.Count)
$offset = 6 + 16 * $sizes.Count
for ($i = 0; $i -lt $sizes.Count; $i++) {
  $dim = if ($sizes[$i] -ge 256) { 0 } else { $sizes[$i] }
  $w.Write([byte]$dim); $w.Write([byte]$dim); $w.Write([byte]0); $w.Write([byte]0)
  $w.Write([uint16]1); $w.Write([uint16]32)
  $w.Write([uint32]$frames[$i].Length); $w.Write([uint32]$offset)
  $offset += $frames[$i].Length
}
foreach ($f in $frames) { $w.Write($f) }
[System.IO.File]::WriteAllBytes((Join-Path $assets 'icon.ico'), $out.ToArray())
Write-Output "Wrote $assets\icon.png and icon.ico"
