param([Parameter(Mandatory = $true)][string]$Out)
# Draws a fake book page so the OCR test does not depend on a checked-in image.
Add-Type -AssemblyName System.Drawing
$bmp = New-Object System.Drawing.Bitmap 900, 400
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.Clear([System.Drawing.Color]::White)
$g.TextRenderingHint = 'ClearTypeGridFit'
$font = New-Object System.Drawing.Font 'Georgia', 16
$text = "Habits are the compound interest of self-improvement.`nThe same way that money multiplies through compound`ninterest, the effects of your habits multiply as you`nrepeat them.`n`n                                    Page 16"
$g.DrawString($text, $font, [System.Drawing.Brushes]::Black, 30, 30)
$bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
