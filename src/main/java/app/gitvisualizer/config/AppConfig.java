package app.gitvisualizer.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.scheduling.TaskScheduler;
import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.scheduling.concurrent.ThreadPoolTaskScheduler;
import org.springframework.web.client.RestClient;

@Configuration
@EnableScheduling
public class AppConfig {

	@Bean
	RestClient gitHubRestClient(GitHubApiProperties properties) {
		SimpleClientHttpRequestFactory requestFactory = new SimpleClientHttpRequestFactory();
		requestFactory.setConnectTimeout(10_000);
		requestFactory.setReadTimeout(30_000);

		RestClient.Builder builder = RestClient.builder()
				.baseUrl(properties.baseUrl())
				.requestFactory(requestFactory)
				.defaultHeader("Accept", "application/vnd.github+json")
				.defaultHeader("X-GitHub-Api-Version", "2026-03-10");

		if (properties.token() != null && !properties.token().isBlank()) {
			builder.defaultHeader("Authorization", "Bearer " + properties.token());
		}

		return builder.build();
	}

	@Bean
	TaskScheduler taskScheduler() {
		ThreadPoolTaskScheduler scheduler = new ThreadPoolTaskScheduler();
		scheduler.setPoolSize(4);
		scheduler.setThreadNamePrefix("github-poller-");
		scheduler.initialize();
		return scheduler;
	}
}
