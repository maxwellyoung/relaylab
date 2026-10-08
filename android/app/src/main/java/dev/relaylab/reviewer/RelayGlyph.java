package dev.relaylab.reviewer;

import android.graphics.Canvas;
import android.graphics.ColorFilter;
import android.graphics.Paint;
import android.graphics.PixelFormat;
import android.graphics.drawable.Drawable;

/** The brand's three connected nodes refer to client, coordinator and runner. */
final class RelayGlyph extends Drawable {
    private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final int kind;
    RelayGlyph(int colour, int kind) { paint.setColor(colour); paint.setStrokeWidth(1.7f); paint.setStrokeCap(Paint.Cap.ROUND); paint.setStyle(Paint.Style.STROKE); this.kind = kind; }
    @Override public void draw(Canvas canvas) {
        canvas.save(); canvas.translate(getBounds().left, getBounds().top);
        canvas.scale(getBounds().width() / 24f, getBounds().height() / 24f);
        if (kind == 0) {
            canvas.drawLine(5, 16, 12, 8, paint); canvas.drawLine(12, 8, 19, 16, paint);
            paint.setStyle(Paint.Style.FILL); canvas.drawCircle(5, 16, 2.3f, paint); canvas.drawCircle(12, 8, 2.3f, paint); canvas.drawCircle(19, 16, 2.3f, paint); paint.setStyle(Paint.Style.STROKE);
        } else if (kind == 1) {
            canvas.drawRoundRect(4, 5, 20, 19, 3, 3, paint); canvas.drawLine(4, 13, 9, 13, paint); canvas.drawLine(9, 13, 10, 15, paint); canvas.drawLine(10, 15, 14, 15, paint); canvas.drawLine(14, 15, 15, 13, paint); canvas.drawLine(15, 13, 20, 13, paint);
        } else if (kind == 2) {
            canvas.drawCircle(12, 12, 8, paint); canvas.drawLine(12, 7, 12, 12, paint); canvas.drawLine(12, 12, 16, 14, paint);
        } else {
            for (int y : new int[]{6, 12, 18}) canvas.drawLine(4, y, 20, y, paint);
            canvas.drawCircle(9, 6, 2, paint); canvas.drawCircle(16, 12, 2, paint); canvas.drawCircle(8, 18, 2, paint);
        }
        canvas.restore();
    }
    @Override public void setAlpha(int value) { paint.setAlpha(value); }
    @Override public void setColorFilter(ColorFilter filter) { paint.setColorFilter(filter); }
    @Override public int getOpacity() { return PixelFormat.TRANSLUCENT; }
}
