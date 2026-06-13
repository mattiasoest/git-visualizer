package app.gitvisualizer.config;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;

@Validated
@ConfigurationProperties(prefix = "github.api")
public record GitHubApiProperties(
		@NotBlank String baseUrl,
		@NotBlank String eventsPath,
		String token,
		@Min(1) @Max(100) int perPage,
		@Min(10) int minPollIntervalSeconds,
		boolean gradualReleaseEnabled,
		@Min(10) int releaseWindowSeconds
) {
}
