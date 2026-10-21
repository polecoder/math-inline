# Cheat Sheet del curso

## 1. Combinatoria y probabilidad básica

- $P(A)=\dfrac{|A|}{|\Omega|}$ (casos favorables / posibles, espacio equiprobable)
- Axiomas de Kolmogorov: $P(A)\geq0$; $P(\Omega)=1$; si $A\cap B=\emptyset\Rightarrow P(A\cup B)=P(A)+P(B)$ (aditividad numerable si son infinitos)
- Derivadas: $P(A^C)=1-P(A)$; $A\subset B\Rightarrow P(B\setminus A)=P(B)-P(A)$, $P(A)\le P(B)$
- Inclusión-exclusión: $P(A\cup B)=P(A)+P(B)-P(A\cap B)$; $|A\cup B\cup C|=|A|+|B|+|C|-|A\cap B|-|A\cap C|-|B\cap C|+|A\cap B\cap C|$
- Partición: $P(A)=\sum_i P(A\cap C_i)$ con $C_i$ partición de $\Omega$
- De Morgan: $(A\cup B)^C=A^C\cap B^C$; $(A\cap B)^C=A^C\cup B^C$
- Regla del producto (conteo): $n_1\times n_2\times\cdots\times n_k$
- Permutaciones $P_n=n!$; Arreglos $A^n_k=\dfrac{n!}{(n-k)!}$; Combinaciones $\binom{n}{k}=\dfrac{n!}{k!(n-k)!}$

## 2. Probabilidad condicional e independencia

- $P(A\mid B)=\dfrac{P(A\cap B)}{P(B)}$, $P(B)>0$
- Regla del producto: $P(A\cap B)=P(B)P(A\mid B)$
- Bayes: $P(A\mid B)=\dfrac{P(B\mid A)P(A)}{P(B)}$
- Independencia: $P(A\cap B)=P(A)P(B)\iff P(A\mid B)=P(A)$

## 3. Variables aleatorias discretas

- f.p.p.: $p(x)=P(X=x)$, con $0\le p(x)\le1$, $\sum p(x)=1$
- f.d.a.: $F(x)=P(X\le x)$ (no decreciente, $\lim_{-\infty}=0,\lim_{+\infty}=1$, continua por derecha, salto en $x$ = $P(X=x)$)
- Conjunta $p(x,y)=P(X=x,Y=y)$; marginal: sumar filas/columnas
- Independencia: $p_{X,Y}(x,y)=p_X(x)p_Y(y)$
- Suma $S=X+Y$ independiente: sumar diagonales $x+y=s$ en tabla de contingencia

## 4. Variables aleatorias continuas

- $f_X\ge0$, $\int_{-\infty}^{\infty}f_X=1$; $P(X=c)=0$; $P(a<X<b)=\int_a^bf_X(x)dx$ (los $<,\le$ da igual)
- $F_X(x)=\int_{-\infty}^xf_X(t)dt$, continua en todo su dominio

## 5. Esperanza y varianza

- Discreta: $E(X)=\sum x\,p(x)$; Continua: $E(X)=\int xf(x)dx$
- $E(h(X))=\sum h(x)p(x)$ ó $\int h(x)f(x)dx$; $E(g(X,Y))=\sum g(x,y)p(x,y)$ ó doble integral
- Positivas enteras: $E(X)=\sum_{k=0}^\infty P(X>k)$; continua $\ge0$: $E(X)=\int_0^\infty(1-F(x))dx$
- Linealidad: $E(X+Y)=E(X)+E(Y)$; $E(cX)=cE(X)$; si indep. $E(XY)=E(X)E(Y)$
- $Var(X)=E((X-E(X))^2)=E(X^2)-E(X)^2$; $\sigma=\sqrt{Var(X)}$
- $Var(cX)=c^2Var(X)$; $Var(X+c)=Var(X)$
- Si $X,Y$ indep.: $Var(X\pm Y)=Var(X)+Var(Y)$
- $Cov(X,Y)=E(XY)-E(X)E(Y)$; indep $\Rightarrow Cov=0$ (recíproco falso)
- $\rho_{XY}=\frac{Cov(X,Y)}{\sigma_X\sigma_Y}\in[-1,1]$; Cauchy-Schwarz: $|Cov(X,Y)|\le\sigma_X\sigma_Y$
- $Cov$ simétrica y bilineal: $Cov(aX+Y,Z)=a\,Cov(X,Z)+Cov(Y,Z)$; $Var(X)=0\iff X$ constante

## 6. Distribuciones usuales

| Dist.                  | f.p.p./densidad                                                                                            | $E(X)$          | $Var(X)$                                                   | Caracterización del uso                                                                                                                |
| ---------------------- | ---------------------------------------------------------------------------------------------------------- | --------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| $Ber(p)$               | $p^k(1-p)^{1-k},\ k\in\{0,1\}$                                                                             | $p$             | $p(1-p)$                                                   | Un único experimento con dos resultados (éxito/fracaso). Ej: lanzar una moneda una vez y ver si sale cara.                             |
| $Bin(n,p)$             | $\binom{n}{k}p^k(1-p)^{n-k}$                                                                               | $np$            | $np(1-p)$                                                  | Número de éxitos en $n$ ensayos independientes idénticos. Ej: en 10 tiradas de un dado, probabilidad de exactamente 3 seises.          |
| $Geo(p)$               | $(1-p)^{k-1}p,\ k\ge1$                                                                                     | $1/p$           | $(1-p)/p^2$                                                | Número de ensayos hasta el primer éxito. Ej: probabilidad de que la primera cara aparezca en el 5º lanzamiento.                        |
| $BN(r,p)$ (bin. neg.)  | $\binom{k-1}{r-1}p^r(1-p)^{k-r}$                                                                           | $r/p$           | $r(1-p)/p^2$                                               | Número de ensayos hasta obtener $r$ éxitos. Ej: probabilidad de necesitar 8 lanzamientos para obtener 3 caras.                         |
| $\mathcal{P}(\lambda)$ | $e^{-\lambda}\lambda^k/k!$                                                                                 | $\lambda$       | $\lambda$                                                  | Número de eventos raros e independientes en un intervalo fijo de tiempo/espacio. Ej: solicitudes a un servidor por minuto.             |
| $Hip(N,K,n)$           | $\dfrac{\binom{K}{k}\binom{N-K}{n-k}}{\binom{N}{n}}$                                                       | $n\dfrac{K}{N}$ | $n\dfrac{K}{N}\left(1-\dfrac{K}{N}\right)\dfrac{N-n}{N-1}$ | Éxitos al extraer una muestra **sin reemplazo** de una población finita. Ej: urna con bolas de dos colores, extracción sin reposición. |
| $U\{1,\ldots,n\}$      | $1/n$                                                                                                      | $(n+1)/2$       | $(n^2-1)/12$                                               | Resultados igualmente probables en un rango finito discreto. Ej: dado justo, probabilidad de sacar un número entre 2 y 5.              |
| $U[a,b]$               | $1/(b-a)$                                                                                                  | $(a+b)/2$       | $(b-a)^2/12$                                               | Valor continuo igualmente probable en un intervalo. Ej: un ómnibus llega en cualquier momento entre las 10:00 y 10:30.                 |
| $exp(\lambda)$         | $\lambda e^{-\lambda x}$                                                                                   | $1/\lambda$     | $1/\lambda^2$                                              | Tiempo de espera hasta que ocurre un evento, tasa constante (sin memoria). Ej: tiempo entre llegadas de clientes a un banco.           |
| $N(\mu,\sigma^2)$      | $\frac{1}{\sigma\sqrt{2\pi}}e^{-(x-\mu)^2/2\sigma^2}$                                                      | $\mu$           | $\sigma^2$                                                 | Fenómenos que resultan de la suma de muchos factores aleatorios pequeños (TCL). Ej: alturas de una población.                          |
| $\chi^2_n$             | $\frac{1}{2^{n/2}\Gamma(n/2)}x^{n/2-1}e^{-x/2}$                                                            | $n$             | $2n$                                                       | Suma de cuadrados de $n$ normales estándar independientes. Usada en IC para $\sigma^2$ y pruebas de bondad de ajuste/independencia.    |
| $t_n$ (t-Student)      | $\frac{\Gamma(\frac{n+1}{2})}{\sqrt{n\pi}\,\Gamma(\frac n2)}\left(1+\frac{t^2}{n}\right)^{-\frac{n+1}{2}}$ | $0\ (n>1)$      | $n/(n-2)\ (n>2)$                                           | Inferencia sobre la media con muestra chica y varianza poblacional desconocida. Ej: IC del 95% para la media con $n=15$.               |

Combinación lineal de normales indep. es normal. Suma de $r$ geométricas iid $\sim BN(r,p)$.

## 7. Desigualdades

- Markov ($X\ge0$): $P(X\ge t)\le\dfrac{E(X)}{t}$
- Chebyshev: $P(|X-\mu|\ge\varepsilon)\le\dfrac{\sigma^2}{\varepsilon^2}$

## 8. Ley de los grandes números

- $\overline{X}_n=\frac1n\sum X_i$; $Var(\overline{X}_n)=\sigma^2/n$
- Débil: $\lim_{n\to\infty}P(|\overline{X}_n-\mu|>\varepsilon)=0\ \forall\varepsilon>0$
- Fuerte (c.s.): $P(\lim_n\overline{X}_n=\mu)=1$, i.e. $\overline{X}_n\xrightarrow{c.s.}\mu$

## 9. Estimación

- Estadístico: función de la muestra que no depende de parámetros desconocidos.
- Consistente: débil $\hat\theta\xrightarrow{P}\theta$; fuerte $\hat\theta\xrightarrow{c.s.}\theta$
- Insesgado: $E(\hat\theta)=\theta$; asint. insesgado: $\lim_nE(\hat\theta)=\theta$
- **Método de momentos**: igualar $E(X^j)=\frac1n\sum X_i^j$ para $j=1,\ldots,k$ y despejar $\theta$
- **Máxima verosimilitud**: $L(\theta)=\prod_i p_X(x_i,\theta)$ (o $f_X$); maximizar $\ell(\theta)=\ln L(\theta)$, $\ell'(\theta)=0$
- $\overline{X}_n$ es estimador insesgado y fuertemente consistente de $\mu$

## 10. Teorema Central del Límite

- $Z=\dfrac{X-\mu}{\sigma}$ (esperanza 0, varianza 1)
- $S_n=\sum X_i$, $Z_n=\dfrac{S_n-n\mu}{\sqrt n\,\sigma}=\dfrac{\overline{X}_n-\mu}{\sigma/\sqrt n}$
- Para $n$ grande: $\overline{X}_n\approx N(\mu,\sigma^2/n)$, $S_n\approx N(n\mu,n\sigma^2)$, $Z_n\approx N(0,1)$
- $\lim_{n\to\infty}F_{Z_n}(z)=\Phi(z)$
- $\Phi(-z)=1-\Phi(z)$; $z_p=\Phi^{-1}(1-p)$

## 11. Intervalos de confianza (nivel $1-\alpha$)

- $\mu$, $\sigma^2$ **conocido**: $\left[\overline{X}_n\pm\dfrac{\sigma\,z_{\alpha/2}}{\sqrt n}\right]$
- $\mu$, $\sigma^2$ **desconocido** (normal, $n$ chico): $\left[\overline{X}_n\pm\dfrac{t_{\alpha/2}(n-1)\,S_n}{\sqrt n}\right]$, con $S_n^2=\frac{1}{n-1}\sum(X_i-\overline{X}_n)^2$
- $\mu$, $\sigma^2$ desconocido, $n$ **grande**: $\left[\overline{X}_n\pm\dfrac{S_n\,z_{\alpha/2}}{\sqrt n}\right]$
- $p$ (Bernoulli), $n$ grande: $\left[\overline{X}_n\pm\dfrac{\sqrt{\overline{X}_n(1-\overline{X}_n)}\,z_{\alpha/2}}{\sqrt n}\right]$
- $\sigma^2$ (normal): $\left[\dfrac{(n-1)S_n^2}{\chi^2_{\alpha/2}(n-1)},\ \dfrac{(n-1)S_n^2}{\chi^2_{1-\alpha/2}(n-1)}\right]$
- $z_p=\Phi^{-1}(1-p)$; $t_p(n)=F_{t_n}^{-1}(1-p)$; $\chi^2_p(n)=F_{\chi^2_n}^{-1}(1-p)$

## 12. Tips rápidos de examen

- "Al menos uno" $\Rightarrow$ usar complemento: $1-P(\text{ninguno})$.
- Sistemas independientes en serie/paralelo: fallo total $=(1-p)^n$ (paralelo).
- Cumpleaños/coincidencias $\Rightarrow$ descomponer en suma de Bernoulli's, usar linealidad de $E$.
- Si piden $P(a\le X\le b)$ con $X$ aprox. normal (TCL) $\Rightarrow$ estandarizar y usar tabla de $\Phi$.
- $\sigma^2$ desconocida y muestra chica $\Rightarrow$ t-Student; grande $\Rightarrow$ normal (CLT); intervalo para $\sigma^2 \Rightarrow \chi^2$.
