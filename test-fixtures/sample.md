# Math Inline sample

Euler's identity: $e^{i\pi} + 1 = 0$, and a fraction $\frac{a+b}{c}$ inline.

Greek and operators: $\alpha, \beta \in \mathbb{R}$, $\sum_{k=1}^{n} k = \frac{n(n+1)}{2}$, $\sqrt{x^2+y^2}$.

Matrices are tall: $\begin{pmatrix} 1 & 0 \\ 0 & 1 \end{pmatrix}$.

Dense paragraph, no blank lines around, so no overflow (a chip instead):
the matrix $\begin{pmatrix} 1 & 0 \\ 0 & 1 \end{pmatrix}$ sits between text lines
with no room around it.

Invalid TeX is underlined: $\frac{a$ and $\undefinedmacro$.

Not math: prices like $5 and $10, escaped \$x\$, and code `$x$`.

```
$not math inside a fence$
```

Single-line display math renders in place: $$\int_0^1 x\,dx = \frac{1}{2}$$, and a taller one becomes a chip: $$\sum_{k=1}^{n} k^2$$.

Multi-line display blocks are drawn on their own lines (a single integral by bands, a table by rows); put the cursor on a line to edit it:

$$
\int_0^1 x\,dx = \frac{1}{2}
$$

$$
\begin{aligned}
(a+b)^2 &= a^2 + 2ab + b^2 \\
(a-b)^2 &= a^2 - 2ab + b^2
\end{aligned}
$$

A block with a TeX error shows its plain TeX, underlined:

$$
\frac{a
$$
