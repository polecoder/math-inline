# Math Inline sample

Euler's identity: $e^{i\pi} + 1 = 0$, and a fraction $\frac{a+b}{c}$ inline.

Greek and operators: $\alpha, \beta \in \mathbb{R}$, $\sum_{k=1}^{n} k = \frac{n(n+1)}{2}$, $\sqrt{x^2+y^2}$.

Matrices are tall: $\begin{pmatrix} 1 & 0 \\ 0 & 1 \end{pmatrix}$.

Invalid TeX is underlined: $\frac{a$ and $\undefinedmacro$.

Not math: prices like $5 and $10, escaped \$x\$, and code `$x$`.

```
$not math inside a fence$
```

Single-line display math renders in place: $$\int_0^1 x\,dx = \frac{1}{2}$$, and a taller one becomes a chip: $$\sum_{k=1}^{n} k^2$$.

Multi-line display blocks fold into a chip; put the cursor on it to edit:

$$
\int_0^1 x\,dx = \frac{1}{2}
$$

$$
\begin{aligned}
(a+b)^2 &= a^2 + 2ab + b^2 \\
(a-b)^2 &= a^2 - 2ab + b^2
\end{aligned}
$$

A block with a TeX error stays unfolded and underlined:

$$
\frac{a
$$
