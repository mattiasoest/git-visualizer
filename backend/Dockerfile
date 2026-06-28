FROM eclipse-temurin:25-jdk-jammy AS build

WORKDIR /app

COPY mvnw pom.xml ./
COPY .mvn .mvn
RUN chmod +x mvnw && ./mvnw dependency:go-offline -B

COPY src ./src
RUN ./mvnw package -DskipTests -B

FROM eclipse-temurin:25-jre-jammy

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends curl \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --system app \
  && useradd --system --gid app app

USER app

COPY --from=build /app/target/gitvisualizer-*.jar app.jar

EXPOSE 8080

ENV JAVA_TOOL_OPTIONS="-Xms128m -Xmx512m"

ENTRYPOINT ["java", "-jar", "app.jar"]
