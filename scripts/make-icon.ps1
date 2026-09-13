# Draws the Folio icon (an open book with an orange bookmark ribbon, in the
# ink-outline style) into assets\icon.png (256px) and assets\icon.ico.
# Run once; outputs are committed.
Add-Type -AssemblyName System.Drawing
$root = Split-Path -Parent $PSScriptRoot
$assets = Join-Path $root 'assets'
New-Item -ItemType Directory -Force $assets | Out-Null

function Draw-Book([int]$size) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'
  $g.Clear([System.Drawing.Color]::Transparent)
  $s = $size / 24.0
  $ink = [System.Drawing.ColorTranslator]::FromHtml('#3a261c')
  $paper = [System.Drawing.ColorTranslator]::FromHtml('#fffaf2')
  $orange = [System.Drawing.ColorTranslator]::FromHtml('#f48f2d')
  $shade = [System.Drawing.ColorTranslator]::FromHtml('#f6e9d2')
  $width = [float]([math]::Max(1.2, 1.9 * $s))
  $pen = New-Object System.Drawing.Pen $ink, $width
  $pen.LineJoin = 'Round'; $pen.StartCap = 'Round'; $pen.EndCap = 'Round'
  $P = { param($x, $y) New-Object System.Drawing.PointF ([float]($x * $s)), ([float]($y * $s)) }

  # Same curves as the dock icon: two pages bowing from a centre spine.
  $book = New-Object System.Drawing.Drawing2D.GraphicsPath
  $book.AddBezier((& $P 12 6.4), (& $P 9.8 4.8), (& $P 6.6 4.4), (& $P 2.4 5))
  $book.AddLine((& $P 2.4 5), (& $P 2.4 18.6))
  $book.AddBezier((& $P 2.4 18.6), (& $P 6.6 18), (& $P 9.8 18.4), (& $P 12 20))
  $book.AddBezier((& $P 12 20), (& $P 14.2 18.4), (& $P 17.4 18), (& $P 21.6 18.6))
  $book.AddLine((& $P 21.6 18.6), (& $P 21.6 5))
  $book.AddBezier((& $P 21.6 5), (& $P 17.4 4.4), (& $P 14.2 4.8), (& $P 12 6.4))
  $book.CloseFigure()
  $g.FillPath((New-Object System.Drawing.SolidBrush $paper), $book)

  # a soft shade on the left page, so it reads as an open book even tiny
  $left = New-Object System.Drawing.Drawing2D.GraphicsPath
  $left.AddBezier((& $P 12 6.4), (& $P 9.8 4.8), (& $P 6.6 4.4), (& $P 2.4 5))
  $left.AddLine((& $P 2.4 5), (& $P 2.4 18.6))
  $left.AddBezier((& $P 2.4 18.6), (& $P 6.6 18), (& $P 9.8 18.4), (& $P 12 20))
  $left.CloseFigure()
  $g.FillPath((New-Object System.Drawing.SolidBrush $shade), $left)

  if ($size -ge 48) {
    $lines = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(150, $ink)), ([float]([math]::Max(1, 1.1 * $s)))
    $lines.StartCap = 'Round'; $lines.EndCap = 'Round'
    foreach ($y in 9.4, 12.2, 15) {
      $g.DrawBezier($lines, (& $P 5 $y), (& $P 6.6 ($y - .3)), (& $P 8.2 ($y - .1)), (& $P 9.6 ($y + .4)))
    }
  }

  $g.DrawPath($pen, $book)
  $g.DrawLine($pen, (& $P 12 6.4), (& $P 12 20))

  $ribbon = [System.Drawing.PointF[]]@((& $P 15.2 5.1), (& $P 15.2 11.8), (& $P 16.9 10.4), (& $P 18.6 11.8), (& $P 18.6 4.8))
  $g.FillPolygon((New-Object System.Drawing.SolidBrush $orange), $ribbon)
  $g.DrawLines($pen, $ribbon)
  $g.Dispose()
  return $bmp
}

$big = Draw-Book 256
$big.Save((Join-Path $assets 'icon.png'), [System.Drawing.Imaging.ImageFormat]::Png)

# A PNG-compressed .ico with 16..256 px frames.
$sizes = 16, 24, 32, 48, 64, 128, 256
$frames = foreach ($sz in $sizes) {
  $bmp = Draw-Book $sz
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
