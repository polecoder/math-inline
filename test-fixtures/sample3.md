# Ejercicio 3

## Consigna

1. Resolver las siguientes ecuaciones diferenciales lineales de primer orden homogéneas:
   1. $y' + y \cos x = 0$
   2. $x(x - 1) y' + (1 - 2x) y = 0$
   3. $y' - \frac{2}{x} y = 0$

2. Resolver las siguientes ecuaciones diferenciales lineales de primer orden no homogéneas:
   1. $y' + y \cos x = \cos x \sin x$
   2. $x(x - 1) y' + (1 - 2x) y + x^2 = 0$
   3. $y' - \frac{2}{x} y = x^4$

## Resolución

Se harán la parte 1 y 2 simultaneamente, ya que para resolver las ecuaciones lineales no homogéneas necesitamos también resolver las homogéneas.

### Ecuación 1

- $y' + y \cos x = \cos x \sin x$

Tenemos las siguientes ecuaciones por resolver:

- $(H)\quad y' + y \cos x=0$
- $(NH)\quad y' + y \cos x=\cos x \sin x$

#### Solución de $(H)$

Operemos:

$$
\begin{aligned}
&y'+y\cos x=0\\
&\iff\\
&\frac{y'}{y}=-\cos x\\
&\iff\\
&\int\frac{y'}{y}dx=\int-\cos xdx\\
&\iff\scriptstyle{(u=y(x);du=y'(x)dx)}\\
&\int\frac{1}{u}du=-\sin x+k_1\\
&\iff\\
&ln|u|+k_2=-\sin x+k_1\\
&\iff\scriptstyle{(C=k_1-k_2)}\\
&ln|u|=-\sin x+C\\
&\iff\\
&u=\pm e^Ce^{-\sin x}\\
&\iff\scriptstyle{(K_1=\pm e^C)}\\
&u=K_1e^{-\sin x}\\
&\iff\scriptstyle{(\text{deshaciendo el cambio de variables})}\\
&y_H=K_1e^{-\sin x}\\
\end{aligned}
$$

#### Solución de $(NH)$

Para esta parte consideramos el método de variación de constantes, y en base a la solución de $(H)$ procedemos:

- $y_P=C(x)e^{-\sin x}$
- $y_P'=C'(x)e^{-\sin x}-C(x)e^{-\sin x}cos(x)$

Sustituimos en la ecuación diferencial:

$$
\begin{aligned}
&y' + y \cos x = \cos x \sin x\\
&\iff\\
&C'(x)e^{-\sin x}-C(x)e^{-\sin x}cos(x)+C(x)e^{-\sin x}\cos x=\cos x \sin x\\
&\iff\\
&e^{-\sin x}(C'(x)-C(x)cos(x)+C(x)\cos x)=\cos x \sin x\\
&\iff\\
&C'(x)-C(x)cos(x)+C(x)\cos x=\frac{\cos x \sin x}{e^{-\sin x}}\\
&\iff\\
&C'(x)=\frac{\cos x \sin x}{e^{-\sin x}}\\
&\iff\\
&\int C'(x)dx=\int \frac{\cos x \sin x}{e^{-\sin x}}dx\\
&\iff\scriptstyle{(u=\sin x;du=\cos (x)dx)}\\
&C(x)+k_1=\int \frac{u}{e^{-u}}du\\
&\iff\\
&C(x)+k_1=\int ue^udu\\
&\iff\scriptstyle{(\text{integración por partes})}\\
&C(x)+k_1=ue^u-\int1e^udu\\
&\iff\\
&C(x)+k_1=ue^u-e^u+k_2\\
&\iff\\
&C(x)+k_1=e^u(u-1)+k_2\\
&\iff\scriptstyle{(K_2=k_1-k_2)}\\
&C(x)=e^u(u-1)+K_2\\
&\iff\scriptstyle{(\text{deshago cambio de variable})}\\
&C(x)=e^{\sin x}(\sin (x)-1)+K_2\\
\end{aligned}
$$

Por lo tanto, podemos hallar la solución particular de $(NH)$:

$$
\begin{aligned}
&y_P=C(x)e^{-\sin x}\\
&\iff\\
&y_P=(e^{\sin x}(\sin (x)-1)+K_2)e^{-\sin x}\\
&\iff\\
&y_P=\sin (x)-1+K_2e^{-\sin x}\\
&\iff\scriptstyle{(\text{eligiendo }K_2=0)}\\
&y_P=\sin (x)-1\\
\end{aligned}
$$

#### Conclusión

Por lo tanto, la solución general para $(NH)$ es la siguiente:

- $y_G=y_H+y_P$, entonces:
- $y_G=Ke^{-\sin x}+sin(x)-1$

Lo que finaliza esta parte.

### Ecuación 2

- $x(x - 1) y' + (1 - 2x) y + x^2 = 0$

Tenemos las siguientes ecuaciones por resolver:

- $(H)\quad x(x - 1) y' + (1 - 2x) y = 0$
- $(NH)\quad x(x - 1) y' + (1 - 2x) y = -x^2$

#### Solución de (H)

Operemos:

$$
\begin{aligned}
&x(x-1)y'+(1-2x)y=0\\
&\iff\\
&y'=\frac{1-2x}{x(x-1)}y\\
&\iff\\
&\frac{y'}{y}=\frac{1-2x}{x(x-1)}\\
&\iff\\
&\int\frac{y'}{y}dx=\int\frac{1-2x}{x(x-1)}dx\\
&\iff\scriptstyle{(u=y(x);du=y'(x)dx)}\\
&\int\frac{1}{u}du=\int\frac{1-2x}{x(x-1)}dx\\
&\iff\scriptstyle{(\text{fracciones simples})}\\
&ln|u|+k_1=\int\frac{-1}{x}+\frac{-1}{x-1} dx\\
&\iff\\
&ln|u|+k_1=\int\frac{-1}{x}+\frac{-1}{x-1} dx\\
&\iff\\
&ln|u|+k_1=-\int\frac{1}{x}dx-\int\frac{1}{x-1} dx\\
&\iff\scriptstyle{(v=x-1;dv=1dx)}\\
&ln|u|+k_1=-ln|x|+k_2-\int\frac{1}{v} dv\\
&\iff\\
&ln|u|+k_1=-ln|x|+k_2-ln|v|+k_3\\
&\iff\scriptstyle{(\text{deshago cambios de variables y }k_4=k_2+k_3-k_1)}\\
&ln|y|=-ln|x|-ln|x-1|+k_4\\
&\iff\\
&ln|y|=-(ln|x|+ln|x-1|)+k_4\\
&\iff\\
&ln|y|=-ln|x(x-1)|+k_4\\
&\iff\scriptstyle{(n\cdot ln(a)=ln(a^n))}\\
&ln|y|=ln\left(\frac{1}{|x(x-1)|}\right)+k_4\\
&\iff\\
&|y|=\frac{e^{k_4}}{|x(x-1)|}\\
&\iff\scriptstyle{(K=e^{k_4})}\\
&y=\frac{K}{x(x-1)}\\
&\iff\scriptstyle{(C=\frac{1}{K})}\\
&y=Cx(x-1)\\
\end{aligned}
$$

#### Solución de (NH)

Para esta parte consideramos el método de variación de constantes, y en base a la solución de $(H)$ procedemos:

- $y_P=C(x)x(x-1)$
- $y_P'=C'(x)x(x-1)+C(x)(2x-1)$

Sustituimos en la ecuación diferencial:

$$
\begin{aligned}
&x(x - 1) y' + (1 - 2x) y = -x^2\\
&\iff\\
&x(x - 1)(C'(x)x(x-1)+C(x)(2x-1)) + (1 - 2x)(C(x)x(x-1)) = -x^2\\
&\iff\scriptstyle{(\text{divido por }x(x-1)\neq0,1)}\\
&x(x - 1)(C'(x)x(x-1)+C(x)(2x-1)) + (1 - 2x)(C(x)x(x-1)) = -x^2\\
&\iff\\
&(C'(x)x(x-1)+C(x)(2x-1)) + (1 - 2x)C(x)= \frac{-x^2}{x(x - 1)}\\
&\iff\\
&C'(x)x(x-1)= \frac{-x^2}{x(x - 1)}\\
&\iff\\
&C'(x)= \frac{-x^2}{x^2(x - 1)^2}\\
&\iff\\
&C'(x)= -\frac{1}{(x - 1)^2}\\
&\iff\\
&\int C'(x)dx= -\int\frac{1}{(x - 1)^2}dx\\
&\iff\scriptstyle{(\text{recordatorio }(*_1))}\\
&C(x)+k_1= -\frac{1}{(-1)(x-1)}+k_2\\
&\iff\scriptstyle{(K=k_2-k_1)}\\
&C(x)+k_1= \frac{1}{x-1}+k_2\\
&\iff\scriptstyle{(K=k_2-k_1)}\\
&C(x)= \frac{1}{x-1}+K\\
\end{aligned}
$$

##### Recordatorio $(*_1)$

En este paso se aplica la regla de la potencia:

$$
\int (x-a)^n=\frac{(x-a)^{n+1}}{n+1}+C\quad\text{con }n\neq-1
$$

También se puede hacer cambio de variable que quizás pueda resultar más simple.

Continuando con el ejercicio, ahora podemos hallar la solución particular de $(NH)$:

$$
\begin{aligned}
&y_P=C(x)x(x-1)\\
&\iff\\
&y_P=\left(\frac{1}{x-1}+K\right)x(x-1)\\
&\iff\\
&y_P=\frac{x(x-1)}{x-1}+Kx(x-1)\\
&\iff\\
&y_P=x+Kx(x-1)\\
&\iff\scriptstyle{(\text{eligiendo }K=0)}\\
&y_P=x\\
\end{aligned}
$$

#### Conclusión

Por lo tanto, la solución general para $(NH)$ es la siguiente:

- $y_G=y_H+y_P$, entonces:
- $y_G=Cx(x-1)+x$, o:
  - $y_G=x(C(x-1)+1)$

Lo que finaliza esta parte.

### Ecuación 3

- $y' - \frac{2}{x} y = x^4$

Tenemos las siguientes ecuaciones por resolver:

- $(H)\quad y'-\frac{2}{x}y=0$
- $(NH)\quad y'-\frac{2}{x}y=x^4$

#### Solución de $(H)$

Operemos:

$$
\begin{aligned}
&y'-\frac{2}{x}y=0\\
&\iff\\
&y'=\frac{2}{x}y\\
&\iff\\
&\int\frac{y'}{y}dx=\int\frac{2}{x}dx\\
&\iff\scriptstyle{(u=y(x);du=y'(x)dx)}\\
&\int\frac{1}{u}du=2\int\frac{1}{x}dx\\
&\iff\\
&ln|u|+k_1=2ln|x|+k_1\\
&\iff\scriptstyle{(\text{deshaciendo el cambio de variables y }C=k_1-k_2)}\\
&ln|y|=ln|x^2|+C\\
&\iff\\
&|y|=|x^2|e^C\\
&\iff\scriptstyle{(K=e^C)}\\
&y=Kx^2\\
\end{aligned}
$$

#### Solución de $(NH)$

Para esta parte consideramos el método de variación de constantes, y en base a la solución de $(H)$ procedemos:

- $y_P=C(x)x^2$
- $y_P'=C'(x)x^2+C(x)2x$

Sustituimos en la ecuación diferencial:

$$
\begin{aligned}
&y'-\frac{2}{x}y=x^4\\
&\iff\\
&C'(x)x^2+C(x)2x-\frac{2}{x}C(x)x^2=x^4\\
&\iff\\
&C'(x)x^2+C(x)2x-2xC(x)=x^4\\
&\iff\\
&C'(x)x^2=x^4\\
&\iff\scriptstyle{(\text{divido por }x^2\neq0)}\\
&C'(x)=x^2\\
&\iff\\
&\int C'(x)dx=\int x^2dx\\
&\iff\\
&C(x)+k_1=\frac{x^3}{3}+k_2\\
&\iff\scriptstyle{(K=k_2-k_1)}\\
&C(x)=\frac{x^3}{3}+K\\
\end{aligned}
$$

Ahora podemos hallar la solución particular de $(NH)$:

$$
\begin{aligned}
&y_P=C(x)x^2\\
&\iff\\
&y_P=\left(\frac{x^3}{3}+K\right)x^2\\
&\iff\\
&y_P=\frac{x^5}{3}+Kx^2\\
&\iff\scriptstyle{(\text{considerando }K=0)}\\
&y_P=\frac{x^5}{3}\\
\end{aligned}
$$

#### Conclusión

Por lo tanto, la solución general para $(NH)$ es la siguiente:

- $y_G=y_H+y_P$, entonces:
- $y_G=Kx^2+\frac{x^5}{3}$

Lo que finaliza esta parte.
